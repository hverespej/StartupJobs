var _cheerio = require('cheerio');
var _city_lookup = require('./lookup_map_city.json');
var _state_lookup = require('./lookup_map_state.json');
var _country_lookup = require('./lookup_map_country.json');


function create_jd(
	log,
	url,
	company,
	title,
	location_text,
	text_description,
	html_description
	) {

	if (typeof(url) !== 'string' || url === null || url.length < 1 ||
		typeof(company) !== 'string' || company === null || company.length < 1 ||
		typeof(title) !== 'string' || title === null || title.length < 1 ||
		typeof(location_text) !== 'string' || location_text === null ||
		typeof(text_description) !== 'string' || text_description === null ||
		typeof(html_description) !== 'string' || html_description === null
		) {

		log.error({
			url: url,
			company: company,
			title: title,
			location_text: location_text,
			text_description: text_description,
			html_description: html_description
		}, 'Error creating jd - invalid params');
		throw new Error('All parameters must be provided and of type "string"');
	}

    return {
        url: url,
        company: company,
        title: title,
        location: map_location(log, location_text),
        text_description: text_description,
        html_description: html_description
    };
}

function get_hashable_text(name) {
    return name.replace(/[\s\.]+/g, '-').toLowerCase();
}

function map_location(log, raw_location) {
	var mapped = {
		raw: raw_location
	};

	var loc_parts = raw_location.split(',');
	for (var i = 0; i < loc_parts.length; i++) {
		var entity = loc_parts[i];
		if (entity.toLowerCase().startsWith('greater ')) {
			entity = entity.substring(8);
		}

		if (entity.toLowerCase().endsWith(' area')) {
			entity = entity.substring(0, entity.length - 5);
		}

	    var key = get_hashable_text(entity);
	    var city, state;
	    if (_city_lookup[key]) {
	        city = _city_lookup[key];
	        state = _state_lookup[city.state];
	        mapped.city = city.canonicalName;
	        mapped.state = state.canonicalName;
	        mapped.country = _country_lookup[state.country].canonicalName;
	        break;
	    } else if (_state_lookup[key]) {
	        state = _state_lookup[key];
	        mapped.state = state.canonicalName;
	        mapped.country = _country_lookup[state.country].canonicalName;
	        break;
	    } else if (_country_lookup[key]) {
	        mapped.country = _country_lookup[key].canonicalName;
	        break;
	    }
	}

	// If we couldn't find the location, set the city to the unknown value
	if (typeof(mapped.country) === 'undefined') {
	    log.warn({ raw_location: raw_location }, 'Location not found in lookup maps');
	    mapped.city = raw_location;
	}

	return mapped;
}

function outer_html(cheerio_node) {
	return _cheerio.load('<span></span>')('span').append(cheerio_node.clone()).html();
}

function scrub_string(text) {
    var result = text.replace('\\\'', '\'');
    result = result.replace('\\"', '"');
    result = result.replace('\\n', ' ');
    result = result.replace('\\r', ' ');
    result = result.replace(/\s+/g, ' ');
    return result.trim();
}

module.exports = {
	create_jd: create_jd,
	outer_html: outer_html,
	scrub_string: scrub_string
};
