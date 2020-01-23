require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';
let FRONTEND_URI = process.env.FRONTEND_URI || 'http://localhost:3000';
const PORT = process.env.PORT || 8888;

if (process.env.NODE_ENV !== 'production') {
  REDIRECT_URI = 'http://localhost:8888/callback';
  FRONTEND_URI = 'http://localhost:3000';
}

const express = require('express');
const request = require('request');
const cors = require('cors');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const path = require('path');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const { generateRandomString } = require('utils');
const { STATE_KEY } = require('constants');

// Multi-process to utilize all CPU cores.
if (cluster.isMaster) {
  console.warn(`Node cluster master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(
      `Node cluster worker ${worker.process.pid} exited: code ${code}, signal ${signal}`,
    );
  });
} else {
  const app = express();

  // Priority serve any static files.
  app
    .use(express.static(path.resolve(__dirname, '../client/build')))
    .use(cors())
    .use(cookieParser())
    .use(
      history({
        verbose: true,
        rewrites: [
          { from: /\/login/, to: '/login' },
          { from: /\/callback/, to: '/callback' },
          { from: /\/refresh_token/, to: '/refresh_token' },
        ],
      }),
    );

  // Serve the react build files when hit on root
  app.get('/', (req, res) => {
    res.render(path.resolve(__dirname, '../client/build/index.html'));
  });

  // Redirect to spotify auth with the redirect_uri, scope & state
  app.get('/login', (req, res) => {
    // Generate a random state value and store it in cookie so that to verify request is comming from same browser tab
    const state = generateRandomString(16);
    res.cookie(STATE_KEY, state);

    // List of spotify user permissions
    const scope =
      'user-read-private user-read-email user-read-recently-played user-top-read user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-public';

    // Redirect to spotify auth where user will login and grand permissions
    res.redirect(
      `https://accounts.spotify.com/authorize?${querystring.stringify({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: scope,
        redirect_uri: REDIRECT_URI,
        state: state,
      })}`,
    );
  });

  // Spotify hits here with authorization_code
  app.get('/callback', (req, res) => {
    // Application requests refresh and access tokens after checking the state parameter
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[STATE_KEY] : null;

    if (state === null || state !== storedState) {
      // Redirect to react-app with error state_mismatch
      res.redirect(`/?${querystring.stringify({ error: 'state_mismatch' })}`);
    } else {
      res.clearCookie(STATE_KEY);
      const authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        form: {
          code: code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        },
        headers: {
          Authorization: `Basic ${new Buffer(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        },
        json: true,
      };

      // POST request to get the access_token and refresh_token
      request.post(authOptions, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const access_token = body.access_token;
          const refresh_token = body.refresh_token;

          // Redirect to react-app with the access_token & refresh_token
          res.redirect(
            `${FRONTEND_URI}/?${querystring.stringify({
              access_token,
              refresh_token,
            })}`,
          );
        } else {
          // Redirect to react-app with error invalid_token
          res.redirect(`/?${querystring.stringify({ error: 'invalid_token' })}`);
        }
      });
    }
  });

  // Start the server and listen on specified PORT
  app.listen(PORT, () => {
    console.warn(`Node cluster worker ${process.pid}: listening on port ${PORT}`);
  });
}
