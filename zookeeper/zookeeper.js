const sha1 = require('node-sha1');
const mcached = require('memchync');
const process = require('process');
const zk = require("node-zookeeper-client");
const client = zk.createClient('localhost:2181');
const fs = require("fs-promise");
let arrLiveNodes = [];
let objServerHashes = {};
const sleep = require('sleepjs')
const chalk = require('chalk');

var objAllServers = {}

let objMemcachedConfig = {
    retries: 1,
    retry: 50,
    timeout:1000
};

function getHashes() {
    for(let strServername in objAllServers) {
       objServerHashes[strServername] = sha1(objAllServers[strServername]); 
    }
    console.log(objServerHashes);
    startDHT();
}


function deleteNode(path) {
    client.getChildren(path, function (error, stat) {
        if (error) {
            console.log(error);
            return;
        }
        console.log(chalk.green("Removed"));
    });
}

function deleteAll() {
    deleteNode('/servers/all_nodes/mem1'); 
    deleteNode('/servers/all_nodes/mem2'); 
}

function getMemcachedNode(key) {
    let hash = sha1(key);
    let truncated = parseInt(Number("0x" + hash.substr(hash.length - 4)), 10);
    let nodeIndex = truncated % arrLiveNodes.length;
    let strServerName = arrLiveNodes[nodeIndex];
    return strServerName;
}


function eventWatcher(event) {
    client.getChildren('/servers/live_nodes', eventWatcher,  function (error, children, stat) {
        if (error) {
            console.log(error);
            return;
        }
        arrLiveNodes = children;
        console.log(chalk.yellow("Live nodes now"), arrLiveNodes);
    });
}

function getLiveNodes() {
    client.getChildren('/servers/live_nodes', eventWatcher,  function (error, children, stat) {
        if (error) {
            console.log("Please register the Memcached servers before running the client");
            process.exit(0);
            return;
        }
        arrLiveNodes = children;
        getHashes();
    });
}


function getAllNodes() {

    client.getChildren('/servers/all_nodes', null, function(error, children, stat) {
        if (error) {
            console.log("Please register the Memcached servers before running the client");
            process.exit(0);
            return;
        }

        if(children.length == 0) {
            console.log(chalk.red("No memcached servers are live"))
            process.exit(0);
        }

        for(let i = 0; i < children.length; i++) {

            client.getData('/servers/all_nodes/' + children[i], function(error, data, stat) {

                if(typeof data !== 'undefined') {
                    let objServer = JSON.parse(data.toString());
                    objAllServers[objServer.name] = objServer.ip;
                }
                if(i == children.length - 1) {
                    console.log("All nodes", objAllServers);
                    if(Object.keys(objAllServers).length == 0) {
                        console.log(chalk.red("No memcached servers registererd into Zookeeper with data"))
                        process.exit(0);
                    }
                    getLiveNodes();
                }
            });
        }
    });
}

async function put(key, value) {
    try {
        if(arrLiveNodes.length == 0) {
            console.log(chalk.red("[PUT]"), "No live nodes available.");
            return;
        }
        let memcachedNodeIP = objAllServers[getMemcachedNode(key)];
        mcached.init(memcachedNodeIP, objMemcachedConfig);
        await mcached.set(key, value, 3600);
        console.log(chalk.green("[PUT]"), "Successfully written to ", memcachedNodeIP);
    } catch(error) {
        console.error(error);
    }
}

async function get(key) {
    let value;

    if(arrLiveNodes.length == 0) {
        console.log(chalk.red("[GET]"), "No live nodes available");
        return;
    }

    for(let i = 0; i < arrLiveNodes.length; i++) {
        try {
            mcached.init(objAllServers[arrLiveNodes[i]], objMemcachedConfig);
            value = await mcached.get(key);
            if(typeof value !== 'undefined') {
                console.log(chalk.green("[GET]"), "Successfully got value ", value);
                break;
            }
        } catch(error) {
            console.error(error);
        }
    }

    return value;
}

async function startDHT() {
    let arrLines = fs.readFileSync('input', 'utf8').split('\n');
    console.log(chalk.green("Starting DHT."));
    for(let line of arrLines) {
        if(line.length) {
            let arrCommand = line.replace(/\s+/g,' ').split(' ');
            //assuming input file is always according to specs, validation is skipped.
            let strCommand = arrCommand[0];
            if(["GET", "PUT", "SLEEP"].includes(strCommand)) {
                if(strCommand === "GET") {
                    let key = arrCommand[1];
                    console.log(chalk.yellow("[GET]"), key)
                    let value = await get(key);
                } else if (strCommand === "PUT") {
                    let key = arrCommand[1];
                    let value = arrCommand[2];
                    console.log(chalk.yellow("[PUT]"), key, value);
                    await put(key, value);
                } else if (strCommand === "SLEEP") {
                    let time = arrCommand[1];
                    console.log(chalk.yellow("[SLEEP]"), time);
                    await sleep(time);
                }
            }
        }
    }
}

(async () => {

    client.connect();
    client.once('connected', () => {
        console.log("Connected");
        getAllNodes();
    });
})();
