const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');


(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const scraper = new nrlScraper();
    var last_season = scraper.season;
    console.log(`Starting at season: ${scraper.season}`)
    console.log("Gathering match urls")
    try {
        for (const url of await scraper.get_match_urls(page)) {
            const split_url = url.split('/');
            const round = split_url[6];
            const season = split_url[5];
            const teams = split_url[7];
            const matchDetails = await scraper.get_match_details(page, url);
            
            if (!scraper.data.seasons[season]) {
                scraper.data.seasons[season] = {};
            }

            // Ensure the round property is initialized
            if (!scraper.data.seasons[season][round]) {
                scraper.data.seasons[season][round] = {};
            }

            // Add match details
            scraper.data.seasons[season][round][teams] = matchDetails;
            // parse int & plus 1 for last season
            if (parseInt(last_season) + 1 === parseInt(season)) {
                console.log(`Completed ${last_season}`);
                last_season = season;
            }
        }
    } catch (error) {
        console.log(error);
    } finally {
        await browser.close();
        scraper.savetojson(scraper.data);
    }
})();

class nrlScraper {
    constructor(save_file='data/raw_nrl_data.json', season=2010, round=1, data={ seasons: {} }) {
        this.save_file = save_file;
        try {
            data = this.getSavedData(save_file);
            const result = this.getLastDataItem(data);
            season = result[0];
            round = result[1].split('-')[1];
        } catch (error) {
            console.log('No existing data found');
        }
        this.data = data;
        this.season = season;
        this.round = round;
    }

    getLastDataItem(data) {
        // Access the seasons object
        const seasons = data.seasons;
        // Get the last season
        const lastSeasonKey = Object.keys(seasons).pop();
        const lastSeason = seasons[lastSeasonKey];
        // Get the last round
        const lastRoundKey = Object.keys(lastSeason).pop();

        return [lastSeasonKey, lastRoundKey];
    };

    getSavedData(save_file) {
        return JSON.parse(fs.readFileSync(save_file, 'utf8'));
    }

    savetojson(rows) {
        const jsonData = JSON.stringify(rows, null, 2);
        fs.writeFileSync(this.save_file, jsonData);
    }

    async gotoWithRetries(page, url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                await page.goto(url, { timeout: 60000 });
                return;
            } catch (err) {
                console.log(`Attempt ${i + 1} to load ${url} failed: ${err.message}`);
                if (i === retries - 1) {
                    throw err;
                }
                await new Promise(res => setTimeout(res, 1000));
            }
        }
    }

    async get_match_urls(page, season=this.season, round=this.round) {
        var last_match_found = false;
        var match_urls = [];
        while (true) {
            let url = `https://www.nrl.com/draw/?competition=111&round=${round}&season=${season}`;
            await page.goto(url, { timeout: 60000 });
            // If being redirected go to next season
            const finalUrl = page.url();
            if (finalUrl !== url) {
                season++;
                round = 1;
                continue
            }
            const content = await page.content();
            const $ = cheerio.load(content);
            
            $('div.match.o-rounded-box.o-shadowed-box').each((index, element) => {
                // If last completed game found break out of loop
                if ($(element).find('.match-cta-strip.u-display-flex.u-flex-justify-content-center.u-gap-16.u-print-display-none.u-spacing-mb-16.u-spacing-ph-16.u-width-100').find('span').text().trim() === 'Team ListsGet Tickets') {
                    last_match_found = true;
                    return;
                }
                const anch = $(element).find('a');
                const href = $(anch).attr('href');
                const match_url = "https://www.nrl.com" + href + "#tab-team-stats";
                match_urls.push(match_url);
            });
            if (last_match_found) {
                return match_urls;

            }
            round++;
        }
    };

    async get_match_details(page, url) {
        await this.gotoWithRetries(page, url)
        const content = await page.content();
        const $ = cheerio.load(content, { xmlMode: false, decodeEntities: true });
        const home_team = $('p.match-team__name.match-team__name--home').text().trim();
        const away_team = $('p.match-team__name.match-team__name--away').text().trim();
        const home_score = this.parse_score($('div.match-team.match-team--home').text());
        const away_score = this.parse_score($('div.match-team.match-team--away').text());
        const venue_stats = this.parse_venue_stats($('p.match-weather__text').text());
        const date = $('p.match-header__title').text().split('-')[1].trim();
        const stadium = $('p.match-venue.o-text').contents().filter(function() {return this.type === 'text';}).text().trim();
        const home_posession = $('p.match-centre-card-donut__value.match-centre-card-donut__value--home').text().trim();
        const away_posession = $('p.match-centre-card-donut__value.match-centre-card-donut__value--away').text().trim();
        const summary_stats = this.parse_summary_stats($, 'div.match-centre-summary-group');
        const figure_stats = this.parse_figure_stats($, 'div.match-centre-card-donut');
        const bar_stats = this.parse_bar_stats($, 'dl.u-display-flex');

        const row = {'url' : url, 'stadium': stadium, 'home_team' : home_team, 'away_team' : away_team, 'match_date' : date, ...venue_stats, 'home_score' : home_score, 'away_score' : away_score, 'home_possession' : home_posession, 'away_possession' : away_posession, ...summary_stats, ...figure_stats, ...bar_stats};
        return row;
    }

    parse_venue_stats(str) {
        const row = {};
        const items = str.split("\n");
        for (let i = 2; i < items.length; i+=2) {
            const key = items[i - 1].replace(/:/g, '').trim().replace(/ /g, '_').toLowerCase();
            const val = items[i].trim();
            row[key] = val;
        }
        return row;
    }

    parse_score(str) {
        // Split the output into lines and filter out empty lines
        const lines = str.split('\n').map(line => line.trim()).filter(line => line);

        // Find the line that contains the integer
        for (const line of lines) {
            // Check if the line can be converted to an integer
            const parsedInt = parseInt(line, 10);
            if (!isNaN(parsedInt)) {
                return parsedInt;
            }
        }
        // Return null if no integer is found
        return null;
    };

    parse_summary_stats($, selector) {
        const row = {};
        $(selector).each((index, element) => {
            const text = $(element).text();
            const items = text.split("\n");
            if (items[2].trim()) {
                var header = items[2].trim().replace(/ /g, '_').toLowerCase();
                var home = items[1].trim();
                var away = items[4].trim();
            } else {
                var header = items[3].trim().replace(/ /g, '_').toLowerCase();
                var home = items[1].trim();
                var away = items[5].trim();
            }
            row[`${header}_home`] = home;
            row[`${header}_away`] = away;
        });
        return row;
    };

    parse_figure_stats($, selector) {
        const row = {};
        $(selector).each((index, element) => {
            const text = $(element).parent().parent().text();
            if (!text.includes('Possession')) {
                const items = text.split("    ");
                const header = items[0].trim().replace(/ /g, '_').toLowerCase();

                if (!(`${header}_home` in row)) {
                    const home = items[1].trim();
                    const away = items[2].trim();

                    row[`${header}_home`] = home;
                    row[`${header}_away`] = away;
                }
            }
        });
        return row;
    };

    parse_bar_stats($, selector) {
        const row = {};
        $(selector).each((index, element) => {
            const text = $(element).parent().text();
            let items = text.split('\n');

            if (items.length === 5) {
                const regex = /^(.*?)\s+home/;
                const match = text.match(regex);

                var header = match[1].trim().replace(/ /g, '_').toLowerCase();
                var home = items[1].trim();
                var away = items[3].trim();

                row[`${header}_home`] = home;
                row[`${header}_away`] = away;
            }
        });
        return row;
    }
}