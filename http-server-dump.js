#!/usr/bin/env node

import http from 'http';
import path from 'path';
import mime from 'mime-types';
import fs from 'fs';

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
			case 'POST': {
				// determine the input format (can throw an exception)
                let contentType = request.headers['content-type'];
				ext = contentType ? mime.extension(contentType) : ext;
				if(!name)
					throw Ex(400, 'Publication name is missing (cannot be empty)');

                console.log("Starting to write to file", name, "...");
                const stream = fs.createWriteStream(name);
                request.lastLog = request.start = time();
                request.on("data", function (chunk) {
                    const now = time();
                    if ((now - request.lastLog) > 1000) {
                        console.log(name, "bytes written :", humanFileSize(stream.bytesWritten));
                        request.lastLog = now;
                    }
                });
                stream.on('finish', function() {
                    console.log("End, elapsed : ", time()-request.start, "ms");
                    response.end("OK");
                });
                request.pipe(stream);
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
			console.log(`Signal ${signal} received, closing...`);
	process.exit(-1);
}

async function main() {

    const port = process.argv[2] || 7000;
    const hostname = '0.0.0.0';

    const server = http.createServer(onRequest);
    server.listen(port, hostname, () =>  console.log('Server running at http://' + hostname + ':' + port));

    process.on("SIGABRT", terminate);
    process.on("SIGINT", terminate);
    process.on("SIGTERM", terminate);
}

main();
