const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const rows = [];

    for (const url of await get_match_urls(page)) {
        const round = url.split('/')[6];
        const season = url.split('/')[5];
        const matchDetails = await get_match_details(page, url);
        
        // Create or update the row for the season and round
        const row = rows.find(r => r[season]) || {};
        row[season] = row[season] || {};
        row[season][round] = row[season][round] || {};
        row[season][round][url] = matchDetails;

        rows.push(row);
    }
    await browser.close();

    const jsonData = JSON.stringify(rows, null, 2);
  
    // Write to a JSON file
    fs.writeFileSync('output.json', jsonData);
})();

async function get_match_urls(page, round=1, season=2010) {
    const currentYear = new Date().getFullYear();
    var match_urls = [];
    while (true) {
        let url = `https://www.nrl.com/draw/?competition=111&round=${round}&season=${season}`;
        await page.goto(url, { waitUntil: 'networkidle2' });
        // If being redirected go to next season
        const finalUrl = page.url();
        if (finalUrl !== url) {
            season++;
            round = 1;
            
            if (season > currentYear) {
                break;
            }
            continue
        }
        const content = await page.content();
        const $ = cheerio.load(content);
        
        $('a.match--highlighted.u-flex-column.u-flex-align-items-center.u-width-100').each((index, element) => {
            const href = $(element).attr('href');
            const match_url = "https://www.nrl.com" + href + "#tab-team-stats";
            match_urls.push(match_url)
        });

        round++;
    }
    return match_urls;
};

async function get_match_details(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' })
    const content = await page.content();
    const $ = cheerio.load(content, { xmlMode: false, decodeEntities: true });
    const home_team = $('p.match-team__name.match-team__name--home').text().trim();
    const away_team = $('p.match-team__name.match-team__name--away').text().trim();
    const home_score = parse_score($('div.match-team.match-team--home').text());
    const away_score = parse_score($('div.match-team.match-team--away').text());
    const venue_stats = parse_venue_stats($('p.match-weather__text').text());
    const date = $('p.match-header__title').text().split('-')[1].trim();
    const stadium = $('p.match-venue.o-text').contents().filter(function() {return this.type === 'text';}).text().trim();
    const home_posession = $('p.match-centre-card-donut__value.match-centre-card-donut__value--home').text().trim();
    const away_posession = $('p.match-centre-card-donut__value.match-centre-card-donut__value--away').text().trim();
    const summary_stats = parse_summary_stats($, 'div.match-centre-summary-group');
    const figure_stats = parse_figure_stats($, 'div.match-centre-card-donut');
    const bar_stats = parse_bar_stats($, 'dl.u-display-flex');

    const row = {'stadium': stadium, 'home_team' : home_team, 'away_team' : away_team, 'match_date' : date, ...venue_stats, 'home_score' : home_score, 'away_score' : away_score, 'home_possession' : home_posession, 'away_possession' : away_posession, ...summary_stats, ...figure_stats, ...bar_stats};
    return row;
}

function parse_venue_stats(str) {
    const row = {};
    let items = str.split("\n");
    for (let i = 2; i < items.length; i+=2) {
        key = items[i - 1].trim();
        val = items[i].trim();
        row[key] = val;
    }
    return row;
}

function parse_score(str) {
    // Split the output into lines and filter out empty lines
    const lines = str.split('\n').map(line => line.trim()).filter(line => line);

    // Find the line that contains the integer
    for (let line of lines) {
        // Check if the line can be converted to an integer
        const parsedInt = parseInt(line, 10);
        if (!isNaN(parsedInt)) {
            return parsedInt;
        }
    }
    // Return null if no integer is found
    return null;
};

function parse_summary_stats($, selector) {
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

function parse_figure_stats($, selector) {
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

function parse_bar_stats($, selector) {
    const row = {};
    $(selector).each((index, element) => {
        const text = $(element).parent().text();
        var items = text.split('\n');

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