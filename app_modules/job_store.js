var _q = require('q');
var _aws = require('aws-sdk');
var _hash = require('object-hash');

// This should really use a separate service like memcached or redis, but 
// given the current simplicity of this app, that's unecessary
var _config;
var _cache;

var _s3_bucket = 'madrona-sjp-test';


///
/// Utility functions
/// 

function createKeyPrefixFromCompany(company) {
	var normalized_company = company.toLowerCase().replace(/[^a-z^0-9^\.^-]+/g, '');
	return 'data/' + normalized_company + '/';
}

function createKeyFromJob(job) {
	var key = createKeyPrefixFromCompany(job.company) + 'jd-' + _hash(job) + '.json';
	return key;
}

function isJobKey(str) {
	return /jd-\w+\.json$/.test(str);
}


///
/// S3 functions
///

function getS3Connection(aws) {
	return _q().then(function() { return new aws.S3(); });
}

function s3BucketExists(log, s3, bucket) {
	var d = _q.defer();

	s3.headBucket({ Bucket: bucket }, function(err, data) {
		if (err) {
			if (err.name === 'NoSuchBucket' || err.name === 'NotFound') {
				d.resolve(false);
			} else {
				d.reject(err);
			}
		} else {
			d.resolve(true);
		}
	});

	return d.promise;
}

function createS3Bucket(log, s3, bucket) {
	var options = {
		Bucket: bucket,
		ACL: 'public-read',
		CreateBucketConfiguration: {
			LocationConstraint: _config.region
		}
	};

	log.info('Creating s3 bucket: ' + bucket);
	return _q.ninvoke(s3, 'createBucket', options).then(function(result) {
		log.info({ bucket: bucket }, 'Created s3 bucket');
		return true;
	});
}

function getAllJobsFromS3(log, s3, bucket, prefix, max_count) {
	var options = {
		Bucket: bucket
	};

	if (typeof(prefix) !== 'undefined' && prefix !== null) {
		options.Prefix = prefix;
	}

	if (typeof(max_count) !== 'undefined') {
		options.MaxKeys = max_count;
	}

	log.info({ bucket: bucket, prefix: prefix }, 'Retrieving jd list from s3');
	return _q.ninvoke(s3, 'listObjects', options).then(function(result) {
		log.info({ bucket: bucket, prefix: prefix, count: result.Contents.length }, 'Retrieved jd list from s3' );

		if ((typeof(max_count) === 'undefined' || result.Contents.length < max_count) && result.IsTruncated) {
			//var nextMarker = result.Contents[data.Contents.length - 1].Key;
			throw new Error('Truncation handling not yet implemented');
		}

		return _q.all(
			result.Contents.filter(function(item) {
				return isJobKey(item.Key);
			}).map(function(item) {
				return getJobFromS3(log, s3, bucket, item.Key).then(function(job) {
					return { key: item.Key, val: job };
				});
			})
		).then(function(jobs) {
			log.info('Details retrieved for all jds');
			var job_map = {};
			for (var i = 0; i < jobs.length; i++) {
				job_map[jobs[i].key] = jobs[i].val;
			}
			return job_map;
		});
	});
}

function getJobFromS3(log, s3, bucket, key) {
	return _q.ninvoke(s3, 'getObject', {
		Bucket: bucket,
		Key: key,
		ResponseContentEncoding: 'utf-8',
		ResponseContentType: 'application/json'
	}).then(function(data) {
		return JSON.parse(data.Body);
	});
}

function addJobsToS3(log, s3, bucket, jobs) {
	var promises = [];
	for (var i = 0; i < jobs.length; i++) {
		promises.push(addJobToS3(log, s3, bucket, jobs[i]));
	}
	return _q.all(promises);
}

function addJobToS3(log, s3, bucket, job) {
	var key = createKeyFromJob(job);

	// Check if item already exists
	if (typeof(_cache[key]) !== 'undefined') {
		log.info({ bucket: bucket, key: key }, 'Would add jd to s3, but it already exists');
		return _q();
	}

	var options = {
		Bucket: bucket,
		Key: key,
		ACL: 'public-read',
		Body: JSON.stringify(job),
		CacheControl: 'max-age=' + (7 * 24 * 60 * 60),
		ContentEncoding: 'utf-8',
		ContentType: 'application/json'
	};

	log.info({ bucket: bucket, key: key }, 'Adding jd to s3');
	return _q.ninvoke(s3, 'putObject', options).then(function(result) {
		log.info({ bucket: bucket, key: key }, 'Added jd to s3');
	});
}

function init(log) {
	log.info('Initializing jd store');

	if (typeof(_cache) !== 'undefined') {
		log.warn('Tried to initialize multiple times');
		return _q();
	}

	if (typeof(_config) === 'undefined') {
		_config = {
			accessKeyId: process.env.AWS_KEY_ID,
			secretAccessKey: process.env.AWS_KEY,
			region: process.env.AWS_REGION
		};
	}
	
	if (typeof(_config.accessKeyId) === 'undefined' ||
		typeof(_config.secretAccessKey) === 'undefined' ||
		typeof(_config.region) === 'undefined') {
		log.error(_config, 'Required config values not set');
		throw new Error('Must define environment variables AWS_KEY_ID, AWS_KEY, and AWS_REGION');
	}

	_aws.config.update(_config);

	log.info({ bucket: _s3_bucket }, 'Loading jds from s3');
	var s3;
	return getS3Connection(_aws).then(function(s3_cxn) {
		s3 = s3_cxn;
		return s3BucketExists(log, s3, _s3_bucket);
	}).then(function(exists) {
		if (!exists) {
			return createS3Bucket(log, s3, _s3_bucket);
		}
	}).then(function() {
		return getAllJobsFromS3(log, s3, _s3_bucket);
	}).then(function(jobs) {
		_cache = jobs;
		log.info({ jd_count: Object.keys(jobs).length }, 'Loaded jds into cache');
	}).then(function() {
		// Remove any jobs with invalid keys. This can happen if s3 objects 
		// are manually created or there's a change in the key gen scheme.
		var options = {
			Bucket: _s3_bucket,
			Delete: { Objects: [] }
		};

		log.info('Checking for invalid jd keys and removing any from cache');
		var invalidJobs = [];
		for (var jobKey in _cache) {
			if (jobKey !== createKeyFromJob(_cache[jobKey])) {
				options.Delete.Objects.push({ Key: jobKey });
				delete(_cache[jobKey]);
			}
		}

		// The AWS SDK has a limit of 1000 keys for the deleteObjects request
		if (options.Delete.Objects.length > 1000) {
			throw new Error('Deletion of more than 1000 keys not yet implemented');
		}

		if (options.Delete.Objects.length > 0) {
			log.warn({ options }, 'Deleting invalid jds from s3');
			return _q.ninvoke(s3, 'deleteObjects', options).then(function(result) {
				log.info(options, 'Deleted jds from s3');
			});
		}
	});
}

function add_jobs(log, jobs) {
	return getS3Connection(_aws).then(function(s3) {
		return addJobsToS3(log, s3, _s3_bucket, jobs);
	});
}

function remove_jobs(log, jobs) {
	if (jobs.length < 1) {
		return _q();
	}

	// The AWS SDK has a limit of 1000 keys for the deleteObjects request
	if (jobs.length > 1000) {
		throw new Error('Deletion of more than 1000 keys not yet implemented');
	}

	var options = {
		Bucket: _s3_bucket,
		Delete: { Objects: [] }
	};

	log.info({ count: jobs.length }, 'Removing jds from cache');
	for (var i = 0; i < jobs.length; i++) {
		var key = createKeyFromJob(jobs[i]);
		delete(_cache[key]);
		options.Delete.Objects.push({ Key: key });
	}

	log.info(options, 'Deleting jds from s3');
	return getS3Connection(_aws).then(function(s3) {
		return _q.ninvoke(s3, 'deleteObjects', options).then(function(result) {
			log.info(options, 'Deleted jds from s3');
		});
	});
}

function query_jobs(log, query) {
	log.info({ query: query }, 'Querying jds');

	var result = [];

	if (typeof(query.company) !== 'undefined') {
		var prefix = createKeyPrefixFromCompany(query.company);
		result = Object.keys(_cache).filter(function(item) {
			return item.startsWith(prefix);
		});
	}

	return _q(result.map(function(cache_key) {
		return _cache[cache_key];
	}));
}

module.exports = {
	init: init,
	add_jobs: add_jobs,
	remove_jobs: remove_jobs,
	query_jobs: query_jobs
};