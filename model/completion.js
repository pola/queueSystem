/* jslint node: true */
"use strict";

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// Schema used for completions
var completionSchema = new Schema({
  name: String,
  assistant: String,
  task: String
});

var Completion = mongoose.model("Completion", completionSchema);
module.exports = Completion;