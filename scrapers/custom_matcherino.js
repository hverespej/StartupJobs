var _q = require('q');
var _cheerio = require('cheerio');
var _node_url = require('url');
var _util = require('./scraper_utils.js');

function scrape(log, company, location, url) {
    log.info({ company: company, url: url }, 'Getting javascript link');
    return _util.request(log, url).then(function(html) {
        var $ = _cheerio.load(html);
        var js_url = _node_url.resolve(url, $('script[src$="/bundle-main.js"]').attr('src'));
        return scrape_js(log, company, location, js_url);
    });
}

function scrape_js(log, company, location, url) {
    log.info({ company: company, url: url }, 'Retrieveing javascript');
    return _util.request(log, url).then(function(js) {
        // Consider using PhantomJS for page rendering instead of parsing Javascript

        log.info({ company: company }, 'Parsing javascript');

        // Extract the root
        var start = js.indexOf('createElement("div",{className:"container"},i["default"].createElement("h1"');
        if (start < 0) {
            d.reject(new Error('Parsing failed due to syntax error'));
            return;
        }
        var root_markers = find_createElement_text(js, start);
        var tree = build_tree(js, root_markers);
        var html = render_html(tree);

        log.info({ company: company }, 'Building jds');
        var jds = create_jds_from_html(log, company, location, url, html);
        return _q.all(jds);
    });
}

function find_createElement_text(original_text, original_text_offset) {
    var start = original_text.indexOf('createElement(', original_text_offset);
    if (start < 0) {
        return null;
    }
    var end = original_text.indexOf('(', start) + 1;

    // Note: This will break if there are unmatched '(' or ')' in 
    // textual (i.e. quoted) values
    var depth = 1;
    while (end < original_text.length && depth > 0) {
        if (original_text[end] === '(') {
            depth++;
        } else if (original_text[end] === ')') {
            depth--;
        }
        end++;
    }

    if (end > original_text.length && original_text[end] !== ')') {
        throw new Error('Parsing failed due to syntax error');
    }

    return { start: start, end: end };
}

function build_tree(full_text, markers) {
    var text = full_text.substring(markers.start, markers.end);
    var tag = /createElement\("([\w-]+)"/.exec(text)[1];
    var next_text_markers = find_createElement_text(text, 1);

    var value;
    if (next_text_markers === null) {
        value = /createElement\("([\w-]+)",.*?,"(.*)"\)/.exec(text)[2];
    } else {
        value = [];
        while (next_text_markers !== null) {
            value.push(build_tree(text, next_text_markers));
            next_text_markers = find_createElement_text(text, next_text_markers.end);
        }
    }

    return { tag: tag, value: value };
}

function render_html(tree) {
    var html = '<' + tree.tag + '>';
    if (typeof(tree.value) === 'string') {
        html += tree.value;
    } else {
        for (var i = 0; i < tree.value.length; i++) {
            html += render_html(tree.value[i]);
        }
    }
    html += '</' + tree.tag + '>';

    return html;
}

function create_jds_from_html(log, company, location, url, html) {
    var $ = _cheerio.load(html);

    var jds = [];
    $('h2').each(function() {
        var aggregated_text = '';
        var aggregated_html = '';
        var next = $(this).next();
        while (next.length > 0 && next[0].name !== 'h2') {
            aggregated_text += _util.scrub_string(next.text()) + ' ';
            aggregated_html += _util.outer_html(next) + ' ';
            next = next.next();
        }

        var new_jd = _util.create_jd(
            log,
            url,
            company,
            _util.scrub_string($(this).text()),
            location,
            aggregated_text.trim(),
            aggregated_html.trim()
        );
        jds.push(new_jd);
    });

    return jds;
}

module.exports = {
    scrape: scrape
};
