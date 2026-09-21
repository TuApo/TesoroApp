// Karma sin lanzador: el navegador se conecta desde afuera (Chrome en Docker con --network host).
// Uso: ng test --karma-config karma.remoto.conf.js --watch=false ... y luego
//      docker run --rm --network host zenika/alpine-chrome --headless --no-sandbox http://127.0.0.1:9876/
const base = require('./karma.nosandbox.conf.js');
module.exports = function (config) {
  base(config);
  config.set({
    browsers: [],
    hostname: '127.0.0.1',
    port: 9876,
    singleRun: true,
    browserNoActivityTimeout: 120000,
    browserDisconnectTimeout: 60000,
    captureTimeout: 600000,
  });
};
