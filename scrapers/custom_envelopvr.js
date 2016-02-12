var _q = require('q');
var _cheerio = require('cheerio');
var _util = require('./scraper_utils.js');

function scrape(log, company, url) {
    log.info({ company: company, url: url }, 'Getting jds');
    return _util.request(log, url).then(function(html) {
        var $ = _cheerio.load(html);
        var jds = [];
        $('.careersContainer > a').each(function() {
            jds.push(scrape_job_description(log, company, $(this).attr('href')));
        });
        return _q.all(jds);
    });
}

function scrape_job_description(log, company, url) {
    log.info({ company: company, url: url }, 'Getting jd');
    return _util.request(log, url).then(function(html) {
        var $ = _cheerio.load(html);
        return _util.create_jd(
            log,
            url,
            company,
            _util.scrub_string($('.updateIntro > h1').text()),
            _util.scrub_string($('.updateIntro > .meta').text().split('\u2022')[0]),
            _util.scrub_string($('.jobInfo').text()),
            $('.jobInfo').html().trim()
        );
    });
}

module.exports = {
    scrape: scrape
};
