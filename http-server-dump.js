#!/usr/bin/env node

import http from 'http';
import path from 'path';
import mime from 'mime-types';
import fs from 'fs';
import yargs from 'yargs';

// Override console functions to add date and time
var logFunctions = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: (console.debug || console.log).bind(console)
};
for (let func in logFunctions) {
	console[func] = function() {
		let args = Array.from(arguments);
		args.unshift("["+func.toUpperCase()+"]");
		args.unshift(new Date().toISOString());
		logFunctions[func].apply(console, args);
	}
}

// Read arguments
let argv = yargs(process.argv.slice(2))
	.usage('\nUsage : $0 [options]')
	.number('port')
	.default('port', 7000, 'TCP port to listen to')
	.boolean('noDump')
	.default('noDump', false, 'If set, do not dump the request body to files')
	.help('h')
	.alias('h', 'help')
	.strictOptions(true)
	.wrap(null)
	.argv;

function Ex(code, ...messages) {
	const error = new Error(messages.join(' '));
	error.code = code;
	return error;
}

function time() {
    return Math.floor(performance.now());
}

function humanFileSize(size) {
    var i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

const mapFiles = new Map();

async function onRequest(request, response) {
	// make case insensible
	const url = new URL((request.socket.ssl? "https://" : "http://") + request.client.remoteAddress + ':' + request.client.remotePort + request.url);
	console.log(request.method, url.toString());
	const name = path.basename(url.pathname);
    let ext = path.extname(url.pathname);

	response.statusCode = 200;
	try {
		// fix CORS policy issue
		response.setHeader('access-control-allow-origin', request.headers.origin || '*');
		
		switch(request.method.toUpperCase()) {
			case 'GET': {
				if (name === "close") { // close the socket pointed by fileName
					// Close the socket pointed by query string option fileName
					const fileName = url.searchParams.get("fileName");
					if (!fileName) {
						throw Ex(400, 'File name is missing (cannot be empty)');
					}
					const file = mapFiles.get(fileName);
					if (!file) {
						throw Ex(404, 'File', fileName, 'not found');
					}
					console.info("Closing file", fileName, "and its socket...");
					file.request.socket.destroy();
					file.request.closeFile(fileName, file.request, file.response);
					response.end();
				} else {
					throw Ex(400, 'Method', name, 'not found');
				}
				break;
			}
			case 'POST': {
				// determine the input format (can throw an exception)
                let contentType = request.headers['content-type'];
				ext = contentType ? mime.extension(contentType) : ext;
				if (!name) {
					throw Ex(400, 'File name is missing (cannot be empty)');
				} else if (mapFiles.has(name)) {
					throw Ex(409, 'File', name, 'already in use');
				}

                console.info("Starting to write to file", name, "...");

                const stream = argv.noDump? null : fs.createWriteStream(name);
                request.start = time();
				request.lastBytesReceived = request.bytesReceived = 0;
				request.lastTime = request.maxTime = 0; // time without data
                request.on("data", function (chunk) {
					let now = time();
					if (request.lastTime && ((now - request.lastTime) > request.maxTime)) {
						request.maxTime = now - request.lastTime;
					}
					request.lastTime = now;
					request.bytesReceived += chunk.byteLength;
                });
				request.logBytes = setInterval(function() {
					console.log(name, "bytes written :", humanFileSize(request.bytesReceived), ", diff :", humanFileSize(request.bytesReceived-request.lastBytesReceived), "maxTime:", request.maxTime, "ms", "status : ", request.socket.destroyed);
					request.lastBytesReceived = request.bytesReceived;
				}, 1000);
				request.on("end", function () {
					request.closeFile(name, request, response);
				});
				request.on("error", function (event) {
					console.warn(name, "socket error :", event);
					request.closeFile(name, request, response);
				});
				request.closeFile = function(fileName, fileRequest, fileResponse) {
					console.info(fileName, "closed, elapsed :", time()-fileRequest.start, "ms, max time without data :", fileRequest.maxTime, "ms");
					fileResponse.end("OK");
					clearInterval(fileRequest.logBytes);
					fileRequest.logBytes = null;
					mapFiles.delete(fileName);
				}
				if (!argv.noDump) {
					request.pipe(stream);
				}
				mapFiles.set(name, {stream, request, response});
				break;
			}
			default:
				throw Ex(405, 'Method', request.method, 'not allowed');
		}
		
	} catch(ex) {
		const code = parseInt(ex.code);
		console.warn(code<520? ex.message : ex);
		response.statusCode = Math.min(code || 456, 520); // 456 Unrecoverable Error
		response.setHeader('content-type', 'text/plain');
		response.end(ex.message);
	}
}

function terminate(signal) {
	if (signal)
			console.info(`Signal ${signal} received, closing...`);
	process.exit(-1);
}

async function main() {
    const hostname = '0.0.0.0';
    const server = http.createServer(onRequest);
    server.listen(argv.port, hostname, () =>  console.info('Server running at http://' + hostname + ':' + argv.port));

    process.on("SIGABRT", terminate);
    process.on("SIGINT", terminate);
    process.on("SIGTERM", terminate);
}

main();
