const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const match_urls = await get_match_urls(page);
    for (const url of match_urls) {
        await get_match_details(page, url);
    }
    await browser.close();

})();

async function get_match_urls(page) {
    var round = 1;
    var season = 2000;
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
            const match_url = "https://www.nrl.com" + href;
            console
            match_urls.push(match_url)
        });

        round++;
    }
    return match_urls;
};

async function get_match_details(page, url) {

}