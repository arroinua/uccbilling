var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var morgan = require('morgan');
var path = require('path');
var mongoose = require('mongoose');
var apiLogger = require('./modules/logger').api;
var http = require('http');
var https = require('https');
var helmet = require('helmet');
var config = require('./env/index');
var fs = require('fs');
var httpLogger = require('./modules/logger').http;

app.use(helmet());

mongoose.connect(config.bdb, { useMongoClient: true });
mongoose.Promise = global.Promise;

// mongoose.connect(config.bdb, config.dbConf);

app.set('views', path.resolve('views'));
app.set('view engine', 'html');
app.engine('html', require('hbs').__express);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

httpLogger.stream = {
  write: function(message, encoding){
    httpLogger.info(message);
  }
};
app.use(morgan("combined", { stream: httpLogger.stream }));

app.use(function(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-type, Content-length, Authorization');
    next();
});
app.use(express.static(path.resolve('app')));

// Response to preflight requests
app.options("/*", function(req, res, next){
  res.send(200);
});

app.use('/subscribers', require('./routes/subscribers'));
app.use('/reseller/api', require('./routes/reseller'));
app.use('/user/api', require('./routes/user'));
app.use('/branch/api', require('./routes/branch'));
app.use('/api', require('./routes/api'));

// app.use('/', require('./routes/index'));

//===============Error handlers================

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  apiLogger.error(err);
  // logger.error(err, {url: req.originalUrl, params: req.body, customerId: req.decoded._id});
  next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {

    //log the error
    // err.localIp = req.ip;
    err.localHostname = req.hostname;
    err.originalUrl = req.originalUrl;
    apiLogger.error(err);

    // TODO: Notify developers

    res.status(err.status || 500);
    res.json({
      message: err.message,
      error: err
    });
    
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });

  // TODO: Notify developers

  //log the error
  // err.localIp = req.ip;
  err.localHostname = req.hostname;
  err.originalUrl = req.originalUrl;
  apiLogger.error(err);
});

//===============Start Server================

http.createServer(app).listen(config.port);
console.log('App is listening at http port %s', config.port);

if(config.ssl) {
  options = {
    key: fs.readFileSync(config.ssl.key),
    cert: fs.readFileSync(config.ssl.cert)
    // requestCert: true,
    // rejectUnauthorized: true
  };

  https.createServer(options, app).listen(config.port+1);
  console.log('App is listening at https port %s', config.port+1);
}

// var server = app.listen(config.port, function () {
//   console.log(server.address());
//   var host = server.address().address;
//   var port = server.address().port;

//   apiLogger.info('App listening at http://%s:%s', host, port);

// });
