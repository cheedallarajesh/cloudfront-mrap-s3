const { SignatureV4MultiRegion } = require('@aws-sdk/signature-v4-multi-region');
const { HttpRequest } = require('@aws-sdk/protocol-http');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { Sha256 } = require('@aws-crypto/sha256-js');
const axios = require('axios');

const failoverHeader = 'originTypeFailover';
const cfReadOnlyHeadersList = [
    'accept-encoding',
    'content-length',
    'if-modified-since',
    'if-none-match',
    'if-range',
    'if-unmodified-since',
    'transfer-encoding',
    'via'
];

exports.handler = async (event) => {
    console.log(`Event: ${JSON.stringify(event)}`);
    console.log("Started lambda function... checking AWS SDK versions");
    console.log(`AWS SDK v3`);
    
    const nodeOptions = "--enable-source-maps";
    console.log(`Node options: ${nodeOptions}`);

    const request = event.Records[0].cf.request;
    console.log(`Request: ${JSON.stringify(request)}`);
    const originKey = Object.keys(request.origin)[0];
    const customHeaders = request.origin[originKey].customHeaders || {};
    console.log(`Custom headers: ${JSON.stringify(customHeaders)}`);

    if (failoverHeader in customHeaders) {
        console.log("Failover request");
        return request;
    }

    const method = request.method;
    const endpoint = `https://${request.origin.custom.domainName}${request.uri}`;
    console.log(`Endpoint: ${endpoint}`);
    const region = 'us-east-2';
    const service = 's3';

    const headers = request.headers;
    const requestHeadersList = Object.keys(headers);

    const cfReadOnlyHeaders = {};
    for (const h of cfReadOnlyHeadersList) {
        if (requestHeadersList.includes(h)) {
            cfReadOnlyHeaders[headers[h][0].key] = headers[h][0].value;
        }
    }

    console.log(`CF read-only headers: ${JSON.stringify(cfReadOnlyHeaders)}`);

    const signer = new SignatureV4MultiRegion({
        credentials: defaultProvider(),
        region, 
        service, 
        sha256: Sha256
    });

    const signedRequest = await signer.sign(
        new HttpRequest({
            method,
            hostname: request.origin.custom.domainName,
            path: request.uri,
            //headers: cfReadOnlyHeaders
            headers: {
                ...cfReadOnlyHeaders,
                'host': request.origin.custom.domainName,
                'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
                'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
            }
        })
    );

    const cfHeaders = {};
    for (const [k, v] of Object.entries(signedRequest.headers)) {
        cfHeaders[k.toLowerCase()] = [{ key: k, value: v }];
    }

    request.headers = cfHeaders;

    if ('querystring' in request) {
        delete request.querystring;
    }

    console.log(`Signed request: ${JSON.stringify(request)}`);

    // Send the signed request using axios for debugging
    try {
        const response = await axios({
            method: signedRequest.method,
            url: endpoint,
            headers: signedRequest.headers
        });
        console.log(`Response: ${response.status} ${response.statusText}`);
        console.log(`Response data: ${JSON.stringify(response.data)}`);
    } catch (error) {
        console.error(`Error: ${error.response ? error.response.status : error.message}`);
        console.error(`Error data: ${error.response ? JSON.stringify(error.response.data) : ''}`);
    }
    
    return request;
};
