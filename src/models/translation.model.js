const mongoose = require('mongoose');
const { toJSON } = require('./plugins');

const translationSchema = mongoose.Schema(
  {
    lang: {
      type: String,
      required: false,
      trim: true,
    },
    name: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
translationSchema.plugin(toJSON);

/**
 * @typedef channelSchema
 */

module.exports = translationSchema;
