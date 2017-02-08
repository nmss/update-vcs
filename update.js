#! /usr/bin/env node
'use strict';

const chalk = require('chalk');
const childProcess = require('child_process');
const flatten = require('lodash/flattenDeep');
const fs = require('fs');
const minimist = require('minimist');
const path = require('path');
const Promise = require('bluebird');

const readDir = Promise.promisify(fs.readdir);
const fsStat = Promise.promisify(fs.lstat);
const log = console.log.bind(console);

const argv = parseArgs();

update(path.resolve(argv._[0]));

function parseArgs() {
	const options = {
		boolean: ['help'],
		string: ['exclude'],
		alias: {
			h: 'help',
			v: 'verbose',
			x: 'exclude'
		}
	};
	const argv = minimist(process.argv.slice(2), options);
	if (argv.help) {
		usage();
	}
	if (argv._.length < 1) {
		argv._.push('.');
	}
	if (argv._.length < 2) {
		argv._.push('');
	}
	if (!Array.isArray(argv.exclude)) {
		argv.exclude = [argv.exclude];
	}
	return argv;
}

function usage() {
	const basename = path.basename(process.argv[1]);
	console.log([
		`Usage: ${basename} [options]`,
		``,
		`Options:`,
		`  -h, --help              Display this help text and exit`,
		`  -v, --verbose <level>   Print more information, level is optional and a number up to 2`,
		'  -x, --exclude <string>  Exclude the folders matching this string',
		``,
		`Examples:`,
		`  ${basename}`,
		`  ${basename} -v`
	].join('\n'));
	process.exit();
}

function exec(command, path) {
	return new Promise((resolve, reject) => {
		if (path) {
			command = `cd ${path} && ${command}`;
		}
		childProcess.exec(command, (err, stdout, stderr) => {
			if (err) {
				if (argv.verbose > 1) {
					console.log('# -', command);
				}
				err.stdout = stdout;
				err.stderr = stderr;
				return reject(err);
			}
			if (argv.verbose > 1) {
				console.log('# +', command);
			}
			return resolve(stdout);
		});
	});
}

function getVcsInfo(pathname) {
	return readDir(pathname)
		.then(files => {
			const info = {
				path: pathname,
				isVcs: false,
				isGit: files.includes('.git'),
				isSvn: files.includes('.svn')
			};
			info.isVcs = info.isGit || info.isSvn;
			if (info.isGit) {
				return fsStat(path.join(pathname, '.git/svn'))
					.then(fileInfo => {
						if (fileInfo.isDirectory()) {
							info.isGitSvn = true;
						}
					})
					.catch(() => { })
					.return(info);
			}
			return info;
		});
}

function listsubFolders(pathName) {
	return readDir(pathName)
		.filter(fileOrDirectory => {
			return fsStat(path.join(pathName, fileOrDirectory))
				.then(stat => stat.isDirectory() && !stat.isSymbolicLink());
		})
		.map(directory => listfolders(path.join(pathName, directory)));
}

function listfolders(folder) {
	return getVcsInfo(folder)
		.then(vcsInfo => {
			if (vcsInfo.isVcs) {
				return [vcsInfo];
			}
			return listsubFolders(folder);
		})
		.then(folders => flatten(folders));
}

function logResult(pathname, details, color) {
	const message = [color(pathname)];
	if (argv.verbose) {
		message.unshift('');
		message.push(details);
	}
	log(message.join('\n'));
}

function gitSvnUpdate(pathname) {
	return exec('git svn rebase', pathname)
		.then(stdout => logResult(pathname, stdout.trim(), chalk.green))
		.catch(err => logResult(pathname, err, chalk.red));
}

function gitUpdate(pathname) {
	return exec('git remote', pathname)
		.then(remotes => {
			if (remotes.length === 0) {
				throw { name: 'noRemote' };
			}
		})
		.then(() => exec('git pull --rebase', pathname))
		.then(stdout => logResult(pathname, stdout.trim(), chalk.green))
		.catch(err => {
			if (err.name === 'noRemote') {
				logResult(pathname, 'Unable to update: there is no remote', chalk.yellow);
			} else {
				logResult(pathname, err, chalk.red);
			}
		});
}

function svnUpdate(pathname) {
	return exec('svn up', pathname)
		.then(stdout => logResult(pathname, stdout.trim(), chalk.green))
		.catch(err => logResult(pathname, err, chalk.red));
}

function filterList(folder) {
	const allIncluded = argv._.slice(1).every(inclusion => folder.path.indexOf(inclusion) !== -1);
	const hasExcluded = argv.exclude.some(exclusion => folder.path.indexOf(exclusion) !== -1);
	return allIncluded && !hasExcluded;
}

function update(folder) {
	process.chdir(folder);
	log(chalk.blue(`Updating ${folder}`));
	return listfolders(folder)
		.each(folderInfo => {
			folderInfo.path = path.relative(folder, folderInfo.path);
		})
		.filter(folder => filterList(folder))
		.map(folderInfo => {
			if (folderInfo.isGit && folderInfo.isSvn) {
				logResult(folderInfo.path, 'Skipping update: git and svn are together in this folder', chalk.yellow);
				return;
			} else if (folderInfo.isGitSvn) {
				return gitSvnUpdate(folderInfo.path);
			} else if (folderInfo.isGit) {
				return gitUpdate(folderInfo.path);
			} else if (folderInfo.isSvn) {
				return svnUpdate(folderInfo.path);
			}
		}, { concurrency: 5 });
}
