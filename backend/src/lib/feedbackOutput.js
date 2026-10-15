// Stable per-metric schemas; transcript-specific IDs stay in the prompt so a
// different customer answer does not require compiling a new Bedrock grammar.
const {rubricFor}=require('./feedbackRubric');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const references={type:'array',items:{type:'string'}};
function config(name,schema){return {textFormat:{type:'json_schema',structure:{jsonSchema:{name,schema:JSON.stringify(schema)}}}};}
function scoring(dimensions){
 const metrics=dimensions.filter(d=>d!=='Confidence');
 const item=object({score:{type:['number','null']},reason:{type:'string',enum:['ASSESSED','INSUFFICIENT_TEXT','CORRUPTED_TRANSCRIPT']},evidenceIds:references});
 return config('qlue_content_scores',object({mode:{type:'string',enum:['TRANSCRIPT_ONLY']},dimensions:object(Object.fromEntries(metrics.map(d=>[d,item])))}));
}
function feedback(dimensions){
 const coaching=object(Object.fromEntries(['observation','why','how','exercise'].map(key=>[key,{type:'string'}])));
 // Nullable single objects make the model's cardinality structural. The saved
 // report and historical plural-array format keep their existing convention.
 const finding=criteria=>({...object({criterion:{type:'string',enum:criteria},evidenceId:{type:'string'},coaching}),type:['object','null']});
 const metrics=Object.fromEntries(dimensions.map(d=>{const rubric=rubricFor(d);return [d,object({strength:finding(rubric.strengths),improvement:finding(rubric.improvements),reason:{type:'string',enum:['ASSESSED','NO_SUPPORTED_FINDING']}})];}));
 return config('qlue_content_findings',object({mode:{type:'string',enum:['TRANSCRIPT_ONLY']},takeaway:object({text:{type:'string'},evidenceIds:references}),dimensionFindings:object(metrics),deliveryFindings:{type:'array',items:object({answerNumber:{type:'integer'},focus:{type:'string',enum:['PAUSE_PLANNING','FILLER_REVIEW','REPEATED_WORD_REVIEW','RECORDING_QUALITY','REVIEW_PACE']}})}}));
}
function stableFeedback(dimensions){
 const prose=object({text:{type:'string'},evidenceIds:references});
 const finding=object({dimension:{type:'string',enum:dimensions.filter(d=>d!=='Confidence')},...prose.properties});
 return config('qlue_stable_feedback',object({mode:{type:'string',enum:['TRANSCRIPT_ONLY']},style:{type:'string',enum:['STABLE_V1']},
  strengths:{type:'array',items:finding},improvements:{type:'array',items:finding},recommendations:{type:'array',items:finding},summary:prose,
  deliveryFindings:{type:'array',items:object({answerNumber:{type:'integer'},focus:{type:'string',enum:['PAUSE_PLANNING','FILLER_REVIEW','REPEATED_WORD_REVIEW','RECORDING_QUALITY','REVIEW_PACE']}})}}));
}
module.exports={scoring,feedback,stableFeedback};
