# Nothing to Declare

Web browser turn-based deception game. 
Players try to make the most money moving products as traders, 
but must fool the customs officer player if they are moving
anything considered illegal (the laws are strict!).

The game is hosted at [cmorley191.github.io](https://cmorley191.github.io),
but also requires access to a backend python server.
Currently there is no "officially" hosted server
-- you'll have to host your own (see Building/Running below).

## Screenshots

Coming soon.

## Building / Running

This project has two parts:
- a backend Websocket-powered proxy server written in python- 
- a static webpage frontend ("client") built by Node.js. 

### Server

The server requires python3 to be installed, as well as the `websockets` pip package.

```pip install websockets```

Run the server with:

```py server/server.py```

On first run, a configuration file will be generated in the same folder as the script.

Notably in that file you can control what kind of servers are hosted: websocket (insecure and secure), and http (insecure and secure). A websocket server is what powers the game (and is therefore required). The client will try to connect to that websocket server with whatever security type that the client is being hosted with (i.e. https->wss, http->ws). The optional http server provided is bare bones and only there to help facilitate an issue with security; since github.io always hosts the client with https, it needs wss, and using a simple self-signed certificate for the wss server might cause problems in the browser. That problem can be resolved by visiting the https server in the browser and accepting the certificate.

Also in that file you can specify the TCP port numbers to run on, but note that the client does not have a way to specify ports yet so you'll have to modify the client code to use different ports.

#### Implementation notes

The server works on a very simple protocol, essentially serving as a proxy between the clients. It does not actually perform any game logic -- rather one client is designated the "host" and acts as the real "game server", accessed via this proxy. In future this proxy server ideally may be replaced with just peer-to-peer connections between the browsers, though that hasn't been looked into yet.

> The server works on a very simple protocol...

From this it should go without saying that this server (and this game overall) does not have security or privacy protections whatsoever, let alone ones that should be relied upon for sensitive information or protocols. Use at your own risk.

### Client

Install Node.js and the Node package manager npm.

Then, in this folder, download dependency packages:

```npm install```

And build the project:

```npm run build-dev```

Then, open (or refresh) in browser: `dist/index.html`

When pushing to source control, please build the project in production mode first:

```npm run build```

#### Implementation notes

The project uses Typescript (strict), React, and Webpack. Pretty much no other packages of note.
