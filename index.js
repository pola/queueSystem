/* jslint node: true */
"use strict";
var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var app = express();
var expressSession = require('express-session');
var MongoStore = require('connect-mongo')(expressSession);
var sharedsession = require('express-socket.io-session');
var port = 8080;
var mongoose = require('mongoose');

mongoose.connect('mongodb://localhost/queueBase');

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
var session = expressSession({
    secret: "MoveFromHereOrTheSecretWillBeOnGit",
    resave: true,
    saveUninitialized: true,
    store: new MongoStore({mongooseConnection: mongoose.connection})
  })
app.use(session);


var httpServer = http.Server(app);


var io = require('socket.io').listen(httpServer);
io.use(sharedsession(session));


var database = require("./model/model.js"); // databas stuff


var db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function callback() {
  console.log("db open!");
});

//===============================================================
// Setting up schemas and lists for the program

var User = database.user;
var Admin = database.admin;
var Queue = database.queue;
var Statistic = database.statistic;
var GlobalMOTD = database.globalMOTD;

//---

var queueSystem = require('./model/queueSystem.js');
var statisticsList = queueSystem.statisticsList;
var validate = queueSystem.validate;
var validateSuper = queueSystem.validateSuper;
var validateTeacher = queueSystem.validateTeacher;
var validateAssistant = queueSystem.validateAssistant;

var router = require('./routes/httpRoutes.js');
app.use('/API',router);

var utils = require('./utils.js');
// var scheduleForEveryNight = utils.scheduleForEveryNight;

// scheduleForEveryNight(function () {
//   queueSystem.forQueue(function (queue) {
//     queue.purgeQueue();
//     queue.purgeBookings();
//   })
//   queueSystem.updateAllBookings();
// });
//===============================================================
// 


function doOnQueue(queueName, action) {
  var queue = queueSystem.findQueue(queueName);
  queue[action]();

  console.log('trying to ' + action + ' ' + queueName);

  io.to(queueName).emit(action);
  io.to("lobby").emit("lobby" + action, queueName);

  if (action === 'hide') {
    io.to("admin").emit('hide', queueName);
  } else if (action === 'show') {
    io.to("admin").emit('show', queueName);
  }
}


// the average time in 'queue' of students who joined the queue 
//  from 'start' and left before/was still in queue at 'end'

/*TODO-DIRR*/
function getAverageQueueTime(queueName, start, end) {
  var userStatisticList = [];

  userStatisticList = getUsersWhoStartedTheQueueBetween(queueName, start, end);

  console.log(userStatisticList);

  var counter = 0;
  var totalTime = 0;
  var now = Date.now();

  console.log("checking between " + new Date(start) + " and " + new Date(end));
  return 0;
}

// Needs to be callbacked to work, else it's doing the right thing
function getUsersWhoStartedTheQueueBetween(queueName, start, end) {
    var userStatisticList = [];
    var counter = 0;

    Statistic.find({startTime: {$gte: start, $lte: end}, queue: queueName, leftQueue: true}, function(err, statistics) {
      statistics.forEach(function(statistic) {
        userStatisticList.push(statistic);
        console.log(new Date(statistic.startTime));
        console.log(end-statistic.startTime);
      });

      return userStatisticList;
    });
}

// number of people who joined the queue from 'start' and left before 'end'
function numbersOfPeopleLeftQueue(queueName, start, end) {
  var userStatisticList = getUsersWhoEnteredAndLeftQueueBetween(queueName, start, end);
  var counter = userStatisticList.length;

  console.log("Number of people left: " + counter);

  return counter;
}

// Needs to be callbacked to work, else it's doing the right thing
function getUsersWhoEnteredAndLeftQueueBetween(queueName, start, end) {
    var userStatisticList = [];
    var counter = 0;
    Statistic.find({startTime: {$gte: start, $lte: end}, queue: queueName, leftQueue: true}, function(err, statistics) {
      statistics.forEach(function(statistic) {
        if (statistic.startTime + statistic.queueLength < end) {
          userStatisticList.push(statistic);
          console.log(new Date(statistic.startTime));
          console.log(counter++);
        }
      });
    });

    return userStatisticList;
}


io.on('connection', function(socket) {
  console.log("connected");
  // Setup the ready route, join room and emit to room.
  socket.on('listen', function(req) {
    console.log('a user added to ' + req);
    socket.join(req);
    console.log("Current user = " + JSON.stringify(socket.handshake.session.user.name));
    if(socket.handshake.session.user.name){ // TODO : Temporary fix
      socket.join('user_' + socket.handshake.session.user.name);
    }
  });

  socket.on('stopListening', function(req) {
    console.log('a user left ' + req);
    socket.leave(req);
  });

  // user joins queue
  socket.on('join', function(req) {
    var queueName = req.queueName;
    var user = req.user;
    user.name = socket.handshake.session.user.name;

    console.log('a user joined to ' + queueName);

    io.to(queueName).emit('join', user);
    io.to("lobby").emit('lobbyjoin', {
      queueName: queueName,
      username: user.name
    });

    var queue = queueSystem.findQueue(queueName);
    var newUser = new User({
      name: user.name,
      location: user.location,
      comment: user.comment,
      type: user.type
    });

    queue.addUser(newUser);

    var newStatistic = new Statistic({
      name: newUser.name,
      queue: queueName,
      startTime: newUser.startTime,
      action: ''
    });

    statisticsList.push(newStatistic);
    newStatistic.save();
  });

  // user tries to join a queue with a "bad location"
  //  - do nothing in backend?
  socket.on('badLocation', function(req) {
    var username = socket.handshake.session.user.name;
    var name = req.name;
    var queueName = req.queueName;

    // teacher/assistant-validation
    if (!(validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for badLocation failed");
      //res.end();
      return;
    }

    io.to("user_" + name).emit('badLocation', {name: name, sender: username, queueName: queueName});
    console.log("Bad location at " + queueName + " for " + name);
  });

  // user gets updated
  socket.on('update', function(req) {
    var queueName = req.queueName;
    var user = req.user;
    user.name = socket.handshake.session.user.name;

    console.log(JSON.stringify(user)); // check which uses is given --- need the one doing the action and the one who is "actioned"

    console.log('a was updated in ' + queueName);
    io.to(queueName).emit('update', user);

    var course = queueSystem.findQueue(queueName);
    course.updateUser(user.name, user);
  });

  // admin helps a user (marked in the queue)
  socket.on('help', function(req) {
    var queueName = req.queueName;
    var name = req.name;
    var username = req.helper;

    // teacher/assistant-validation
    if (!(validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for help failed");
      //res.end();
      return;
    }

    var course = queueSystem.findQueue(queueName);
    course.helpingQueuer(name, queueName);

    io.to(queueName).emit('help', {
      name: name,
      helper: username
    });

    console.log(name + ' is getting help in ' + queueName);
  });

  // admin stops helping a user (marked in the queue)
  socket.on('stopHelp', function(req) {
    var queueName = req.queueName;
    var name = req.name;
    var username = req.helper;

    // teacher/assistant-validation
    if (!(validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for help failed");
      //res.end();
      return;
    }

    var course = queueSystem.findQueue(queueName);
    course.stopHelpingQueuer(name, queueName);

    io.to(queueName).emit('stopHelp', {
      name: name,
      helper: username
    });

    console.log(name + ' is no longer getting help in ' + queueName);
  });

  // teacher/assistant messages a user
  socket.on('messageUser', function(req) {
    var queue = req.queueName;
    var name = req.name;
    var message = req.message;
    var sender = req.sender;

    io.to("user_" + name).emit('msg', {
      message: message,
      sender: sender
    });

    console.log('user ' + name + ' was messaged from ' + sender + ' at ' + queue + ' with: ' + message);
  });

  // teacher/assistant emits to all users (teacher/assistant included)
  socket.on('broadcast', function(req) {
    var queueName = req.queueName;
    var message = req.message;
    var username = req.sender;

    // teacher/assistant-validation
    console.log("validation is :" + validate(username, "assistant", queueName));
    if (!(validate(username, "assistant", queueName))) {
      console.log("validation for emit failed");
      //res.end();
      return;
    }

    io.to(queueName).emit('msg', {
      message: message,
      sender: username
    });

    console.log('emit in ' + queueName + ', msg: ' + message);
  });

  // teacher/assistant emits to all teacher/assistant
  socket.on('broadcastFaculty', function(req) {
    console.log("Recevie request to send message to faculty");
    var queueName = req.queueName;
    var message = req.message;
    var username = req.sender;

    console.log("queueName = " + queueName);
    console.log("message = " + message);
    console.log("username = " + username);

    // teacher/assistant-validation
    if (!(validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for emitTA failed");
      //res.end();
      return;
    }

    var queue = queueSystem.findQueue(queueName);
    var teacherList = queue.teacher;
    var assistantList = queue.assistant;

    for (var i = teacherList.length - 1; i >= 0; i--) {
      var teacher = teacherList[i];

      io.to("user_" + teacher.name).emit('msg', {
        message: message,
        sender: username
      });

      console.log("emiting teacher: " + "user_" + teacher.name);
    }

    for (var i = assistantList.length - 1; i >= 0; i--) {
      var assistant = assistantList[i];

      io.to("user_" + assistant.name).emit('msg', {
        message: message,
        sender: username
      });

      console.log("emiting assistant: " + assistant.name);
    }

    //  io.to(queueName).emit('msg', {message: message, sender: username});
    console.log('emitTA in ' + queueName + ', msg: ' + message);
  });

  // user leaves queue
  socket.on('leave', function(req) {
    var queueName = req.queueName;
    var user = {name: socket.handshake.session.user.name};
    var booking = req.booking;

    console.log(user.name); // check which uses is given --- need the one doing the action and the one who is "actioned"
    console.log("Validerande: " + JSON.stringify(socket.handshake.session.user));

    var queue = queueSystem.findQueue(queueName);

    userLeavesQueue(queue, user.name, booking);

    console.log('a user left ' + queueName);

    io.to(queueName).emit('leave', user);
    io.to("lobby").emit('lobbyleave', {
      queueName: queueName,
      username: user.name
    });
  });

  // user being kicked from queue
  socket.on('kick', function(req) {
    var queueName = req.queueName;
    var user = req.user;

    console.log(JSON.stringify(user)); // check which uses is given --- need the one doing the action and the one who is "actioned"
    console.log("Validerande: " + JSON.stringify(socket.handshake.session.user));

    var queue = queueSystem.findQueue(queueName);

    userLeavesQueue(queue, user.name);

    console.log('a user left ' + queueName);

    io.to(queueName).emit('leave', user);
    io.to("lobby").emit('lobbyleave', {
      queueName: queueName,
      username: user.name
    });
  });

  /*TODO-DIRR*/
  function userLeavesQueue(queue, userName, booking) {
    queue.removeUser(userName);
    if (booking) {
      queue.removeBooking(userName);
    }

    for (var i = statisticsList.length - 1; i >= 0; i--) {
      var statistic = statisticsList[i];
      if (statistic.name === userName && !statistic.leftQueue) {
        var queueLength = Date.now() - statistic.startTime;
        statistic.userLeaves(queueLength);

        statisticsList.splice(i, 1, statistic);
      }
    }
  }

  // admin purges a queue
  socket.on('purge', function(req) {
    console.log("called purge:");
    console.log(socket.handshake.session.user);

    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;
    // socket.handshake.session.user = "troll";

    console.log(validate(username, "teacher", queueName));

    // admin/teacher/assistant-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for purge failed");
      //res.end();
      return;
    }

    var queue = queueSystem.findQueue(queueName);

    for (var i = queue.queue.length - 1; i >= 0; i--) { // TODO : While length > 0
      userLeavesQueue(queue, queue.queue[i].name);
    }

    queue.purgeQueue();
    queue.queue = [];

    console.log(req.queue + ' -list purged by ' + username);

    io.to(queueName).emit('purge');
    io.to("lobby").emit('lobbypurge', queueName);
  });

  // trying to schedule a lab session
  socket.on('addSchedule', function(req) {
    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for lock failed");
      //res.end();
      return;
    }

    console.log("Validation successful. Would have scheduled: " + JSON.stringify(req.schedule));
  });

  // trying to clear all schedules for a given queue
  socket.on('removeSchedules', function(req) {
    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for lock failed");
      //res.end();
      return;
    }

    console.log("Validation successful. Would have cleared the schedule for : " + queueName);
  });

  //===============================================================


  // admin locks a queue
  socket.on('lock', function(req) {
    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for lock failed");
      //res.end();
      return;
    }

    doOnQueue(queueName, 'lock');
  });

  // admin unlocks a queue
  socket.on('unlock', function(req) {
    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName) || validate(username, "assistant", queueName))) {
      console.log("validation for unlock failed");
      //res.end();
      return;
    }

    doOnQueue(queueName, 'unlock');
  });

  socket.on('hide', function(req) {
    var queueName = req.queueName;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("Current user " + username + " is not a teacher for that queue or an admin.");
      //console.log("validation for hide failed");
      //res.end();
      return;
    }

    doOnQueue(queueName, 'hide');
  });

  socket.on('show', function(req) {
    var queueName = req.queue;
    var username = socket.handshake.session.user.name;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for show failed");
      //res.end();
      return;
    }

    doOnQueue(req.queue, 'show');
  });

  //===============================================================

  socket.on('getStatistics', function(req) {
    var queueName = req.queueName;
    var start = req.start;
    var end = req.end;
    console.log("start: " + start);
    console.log("end: " + end);
    
    var name = req.user;
    console.log("user = " + name);
    
    // Statistic.find({queue:queueName},function (err, stats) {
    Statistic.find({queue:queueName, startTime: {"$gte": start, "$lt": end}},function (err, stats) {
      if (err) return console.error(err);
      // console.log(stats);
      // Creating an object to return
      var retObject = {};
      retObject.averageQueueTime = getAverageQueueTime(queueName, start, end);
      retObject.numbersOfPeopleLeftQueue = numbersOfPeopleLeftQueue(queueName, start, end);
      retObject.rawJSON = JSON.stringify(stats);

      // console.log("Reurning the following statistics to " + name + ": " + JSON.stringify(retObject));
      // Return all the found data
      socket.emit('getStatistics', retObject);
    });
  });

  //===============================================================

  //
  socket.on('addQueue', function(req) {
    console.log("Trying to add Queue!");
    var username = socket.handshake.session.user.name;
    // admin-validation
    if (!validate(username, "super", "queue")) {
      console.log("validation for addQueue failed");
      //res.end();
      return;
    }
    var queueName = req.queueName;

    var newQueue = queueSystem.addQueue(queueName);

    io.to('admin').emit('addQueue', newQueue);
  });

  //
  socket.on('removeQueue', function(req) {
    console.log("Trying to remove Queue!");

    var username = socket.handshake.session.user.name;
    var queueName = req.queueName;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for removeQueue failed");
      //res.end();
      return;
    }

    queueSystem.removeQueue(queueName);

    console.log(queueName + ' is getting removed from queues');

    io.to('admin').emit('removeQueue', queueName);
  });

  //
  socket.on('addAdmin', function(req) {
    console.log("Trying to add Admin!");

    var username = socket.handshake.session.user.name;
    // admin-validation
    if (!validate(username, "super", "queue")) {
      console.log("validation for addAdmin failed");
      //res.end();
      return;
    }
    var username = req.username;
    queueSystem.addAdmin(username,username);

    console.log(username + ' is a new admin!');
    io.to('admin').emit('addAdmin', {
      name: username,
      username: username,
      addedBy: ''
    });
  });

  //
  socket.on('addTeacher', function(req) {
    var username = socket.handshake.session.user.name;
    var queueName = req.queueName;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for addTeacher failed");
      //res.end();
      return;
    }

    var username = req.username;
    var teacherName = username;
    var queue = queueSystem.findQueue(queueName);

    var newTeacher = new Admin({
      name: teacherName,
      username: username
    });

    queue.addTeacher(newTeacher);

    console.log(teacherName + ' is a new teacher!');

    io.to('admin').emit('addTeacher', {
      name: teacherName,
      username: username,
      queueName: queueName
    });
  });

  //
  socket.on('addAssistant', function(req) {
    var username = socket.handshake.session.user.name;
    var queueName = req.queueName;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for addAssistant failed");
      //res.end();
      return;
    }

    var username = req.username;
    var assistantName = username;
    var queue = queueSystem.findQueue(queueName);

    var newAssistant = new Admin({
      name: assistantName,
      username: username
    });

    queue.addAssistant(newAssistant);

    console.log(assistantName + ' is a new assistant!');

    io.to('admin').emit('addAssistant', {
      name: assistantName,
      username: username,
      queueName: queueName
    });
  });

  //
  socket.on('removeAdmin', function(req) {
    console.log("Trying to remove Admin!");

    var username = socket.handshake.session.user.name;

    // admin-validation
    if (!validate(username, "super", "queue")) {
      console.log("validation for removeAdmin failed");
      //res.end();
      return;
    }

    var username = req.username;
    queueSystem.removeAdmin(username);

    console.log(username + ' is a removed from admin!');

    io.to('admin').emit('removeAdmin', username);
  });

  //
  socket.on('removeTeacher', function(req) {
    var username = socket.handshake.session.user.name;
    var queueName = req.queueName;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for addAssistant failed");
      //res.end();
      return;
    }

    var username = req.username;
    var queue = queueSystem.findQueue(queueName);

    queue.removeTeacher(username);

    console.log(username + ' is a removed as a teacher in ' + queueName + '!');

    io.to('admin').emit('removeTeacher', {
      username: username,
      queueName: queueName
    });
  });

  //
  socket.on('removeAssistant', function(req) {
    var username = socket.handshake.session.user.name;
    var queueName = req.queueName;

    // admin/teacher-validation
    if (!(validate(username, "super", "queue") || validate(username, "teacher", queueName))) {
      console.log("validation for addAssistant failed");
      //res.end();
      return;
    }

    var queue = queueSystem.findQueue(queueName);

    queue.removeAssistant(username);

    console.log(username + ' is a removed as a assistant in ' + queueName + '!');

    io.to('admin').emit('removeAssistant', {
      username: username,
      queueName: queueName
    });
  });

  // Add a comment about a user
  socket.on('flag', function(req) {
    var username = req.name;
    var queueName = req.queueName;
    var sender = socket.handshake.session.user.name;
    var message = req.message;

    // teacher/assistant-validation
    if (!(validate(sender, "teacher", queueName) || validate(sender, "assistant", queueName))) {
      console.log("validation for flag failed");
      //res.end();
      return;
    }

    var course = queueSystem.findQueue(queueName);
    course.addAssistantComment(username, sender, queueName, message);

    console.log('flagged');
    io.to(queueName).emit('flag', {
      name: username,
      message: message
    });
  });

  // Remove all comments about a user
  socket.on('removeFlags', function(req) {
    var username = req.name;
    var queueName = req.queueName;
    var sender = socket.handshake.session.user.name;

    // teacher/assistant-validation
    if (!(validate(sender, "teacher", queueName) || validate(sender, "assistant", queueName))) {
      console.log("validation for flag failed");
      //res.end();
      return;
    }

    var course = queueSystem.findQueue(queueName);
    course.removeAssistantComments(username, sender, queueName);

    console.log('removed flags');
    io.to(queueName).emit('removeFlags', {
      name: username
    });
  });

  socket.on('completion', function(req) {
    var queueName = req.queueName;
    var username = req.username;
    var assistant = socket.handshake.session.user.name;

    // teacher/assistant-validation
    if (!(validate(assistant, "teacher", queueName) || validate(assistant, "assistant", queueName))) {
      console.log("validation for addMOTD failed");
      //res.end();
      return;
    }

    // find the course and save the MOTD to the course in the database
    var course = queueSystem.findQueue(queueName);
    course.setCompletion(username, assistant, queueName);

    console.log('completion');
    io.to(queueName).emit('completion', {
      name: username
    });
  });

  socket.on('setMOTD', function(req) {
    var queueName = req.queueName;
    var MOTD = req.MOTD;
    var sender = req.sender;

    // teacher/assistant-validation
    if (!(validate(sender, "teacher", queueName) || validate(sender, "assistant", queueName))) {
      console.log("validation for addMOTD failed");
      //res.end();
      return;
    }

    // find the course and save the MOTD to the course in the database
    var course = queueSystem.findQueue(queueName);
    course.addMOTD(MOTD);

    console.log('\'' + MOTD + '\' added as a new MOTD in ' + queueName + '!');

    io.to(queueName).emit('setMOTD', {
      MOTD: MOTD
    });
  });

  socket.on('setInfo', function(req) {
    var queueName = req.queueName;
    var info = req.info;
    var sender = req.sender;

    // teacher/assistant-validation
    if (!(validate(sender, "teacher", queueName) || validate(sender, "assistant", queueName))) {
      console.log("validation for addMOTD failed");
      //res.end();
      return;
    }

    // find the course and save the MOTD to the course in the database
    var course = queueSystem.findQueue(queueName);
    course.setInfo(info); // TODO : does not exist

    console.log('\'' + info + '\' added as a new info in ' + queueName + '!');

    io.to(queueName).emit('setInfo', {
      info: info
    });
  });

  socket.on('addServerMessage', function(req) {
    var globalMOTD = req.message;
    var sender = req.sender;
    console.log("sender = " + sender);

    // teacher/assistant-validation
    if (!validate(sender, "super", "")) {
      console.log("validation for addServerMessage failed");
      //res.end();
      return;
    }

    // * save globalMOTD to database
    GlobalMOTD.find(function(err, globals) {
      globals.forEach(function(global) {
        // to make sure everything loads
        global.addGlobalMOTD(globalMOTD);
      });
    });

    queueSystem.setGlobalMOTD(globalMOTD);

    console.log('\'' + globalMOTD + '\' added as a new global MOTD!');

    io.to('admin').emit('newServerMessage', globalMOTD);
  });


  // TODO : This has been changed to only have them join a room based on their ID, no more session interaction
  socket.on('setUser', function(req) {
    console.log("user_" + req.name);
    socket.join("user_" + req.name); // joina sitt eget rum, för privata meddelande etc
    socket.handshake.session.user = req;
    console.log('Socket-setUser: ' + JSON.stringify(req));
    console.log('session is: ' + JSON.stringify(socket.handshake.session.user));
  });
});

httpServer.listen(port, function() {
  console.log("server listening on port", port);
});