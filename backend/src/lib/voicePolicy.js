'use strict';
// Premium personas remain discoverable, but paid synthesis is locked for all
// accounts until a future server-owned launch. Stored legacy preferences cannot
// bypass this policy.
const DEFAULT_VOICE='Ruth';
const STANDARD_VOICES=['Ruth','Joanna','Matthew','Stephen'];
const preference=voice=>({voiceId:STANDARD_VOICES.includes(voice)?voice:DEFAULT_VOICE,voiceMode:'cost_saver',engine:'neural'});
module.exports={DEFAULT_VOICE,STANDARD_VOICES,preference};
