const find = require('find-process');
const dns = require('dns');
const chalk = require("chalk");
const process = require('process');
const zookeeper = require("node-zookeeper-client");
const client = zookeeper.createClient('127.0.0.1:2181');

let serverAlive = true;

function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

if(process.argv.length == 4) {
    var serverName = process.argv[2];

    if(serverName === 'random') {
        serverName = 'node' + getRandomInt(4);
    }

    var serverIpPort = process.argv[3];
    let serverJSON = {"name": serverName, "ip": serverIpPort};
    var objServerData = Buffer.from(JSON.stringify(serverJSON));
} else {
    console.error("Process requires server name and IP:Port as command line argument");
    process.exit(0);    
}

function notify_zookeeper_service_went_down() {
    serverAlive = false;
    console.log(chalk.red("[Fail]") + " Service went down");
    
    client.remove("/servers/live_nodes/" + serverName, (error) => {
        if(error) {
            console.error(error);
            serverAlive = true;
        }
        console.log("Deleted " + "/servers/live_nodes/" + serverName);
        client.getChildren('/servers/live_nodes',  function (error, children, stat) {
            if (error) {
                console.log(error);
                return;
            }

            console.log(children);
        });
    });
}

function notify_zookeeper_service_went_live() {
    serverAlive = true;
    console.log(chalk.green("[OK]") + " Service went live");

    client.create("/servers/live_nodes/" + serverName, objServerData, zookeeper.CreateMode.EPHEMERAL, (error) => {
        if(error) {
            console.error(error);
            serverAlive = false;
        }

        console.log("Created " + "/servers/live_nodes/" + serverName);
        client.getChildren('/servers/live_nodes',  function (error, children, stat) {
                if (error) {
                    console.log(error);
                    return;
                }
    
                console.log(children);
        });
    });
}

async function check_network_connectivity() {
    dns.resolve4("www.google.com", (error, address) => {
        if(error) {
            if(serverAlive) {
                notify_zookeeper_service_went_down();
            }
        } else {
            if(!serverAlive) {
                notify_zookeeper_service_went_live();
            }
        }
    });
}

async function check_memcached_liveliness() {
    try {
        const arrProcesses = await find('port', 11211);
        if(arrProcesses.length === 0) {
            if(serverAlive) {
                notify_zookeeper_service_went_down();
            }
        } else {
            check_network_connectivity();
        }   
    } catch (error) {
        console.error(error);
    }
}

function attach_signal_handlers() {
    process.on('SIGTERM', notify_zookeeper_service_went_down);
    process.on('SIGHUP', notify_zookeeper_service_went_down);
    process.on('SIGBUS', notify_zookeeper_service_went_down);
    process.on('SIGFPE', notify_zookeeper_service_went_down);
    process.on('SIGSEGV', notify_zookeeper_service_went_down);
    process.on('SIGILL', notify_zookeeper_service_went_down);
}

function start_watchdog() {
    console.log("Starting watchdog...");
    console.log(chalk.green("[OK]") + " Service went live");
    attach_signal_handlers();
    setInterval(async () => {
        check_memcached_liveliness();
    }, 100);
}

function register_live_node() {

    client.exists("/servers/live_nodes/" + serverName, (error, exists) => {
        if(error) {
            console.error("Cannot check if /servers/live_nodes/" + serverName + "exists");
            console.error(error);
        } else {
            if(!exists) {
                client.create("/servers/live_nodes/" + serverName, objServerData, zookeeper.CreateMode.EPHEMERAL, (error) => {
                    if(error) {
                        console.error(error);
                        console.log("Cannot create /servers/live_nodes/" + serverName);
                    } else {
                        console.log(chalk.green("[OK]") + " Registered server in all_nodes");
                        start_watchdog();                     
                    }
                });
            } else {
                start_watchdog();                         
            }
        }
    });
}

function register_server() {
    client.exists("/servers/all_nodes/" + serverName, (error, exists) => {
        if(error) {
            console.error("Cannot check if /servers/all_nodes exists");
            console.error(error);
        } else {
            if(!exists) {
                client.create("/servers/all_nodes/" + serverName, objServerData, zookeeper.CreateMode.EPHEMERAL, (error) => {
                    if(error) {
                        console.error("Cannot create /servers/all_nodes/" + serverName);
                        console.error(error);
                    } else {
                        console.log(chalk.green("[OK]") + " Registered server in all_nodes");
                        register_live_node();                  
                    }
                });
            } else {
                register_live_node();
            }
        }
    });
}

function create_paths() {
    client.mkdirp("/servers/all_nodes", (error, path) => {
        if(error) {
            console.error("Cannot create /servers/all_nodes");
            console.error(error);
            return;
        } else {
            console.log("Created /servers/all_nodes")
            client.mkdirp("/servers/live_nodes", (error, path) => {
                if(error) {
                    console.error("Cannot create /servers/live_nodes");
                    console.error(error);
                    return;
                } else {
                    console.log("Created /servers/live_nodes");
                    register_server();
                }
            });
        }
    });
}

(async () => {
    client.connect();
    client.once('connected', () => {
        console.log(chalk.green("[OK]") + " Connected to Zookeeper");
        create_paths();
    });
})();
