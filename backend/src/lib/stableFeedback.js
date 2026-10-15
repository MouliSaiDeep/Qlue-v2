// v1.0.8's direct qualitative feedback, with the current proof and factual
// protections. Model-written prose is retained instead of replaced by a
// criterion template; this contract does not change scoring or persistence.
const assessment = require('./transcriptAssessment');
const editorialText = require('./feedbackCoaching').text;
const STYLE = 'STABLE_V1';

function validate(parsed, transcript, scores) {
  try {
    if (parsed?.mode !== assessment.MODE || parsed.style !== STYLE) return null;
    const catalog = new Map(assessment.evidenceCatalog(transcript).map(e => [e.id, e]));
    const byDimension = {}, findingEvidence = {strengths:[], improvements:[]};
    const seen = new Set();
    function prose(item, summary = false) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).some(k => !['dimension','text','evidenceIds'].includes(k))
          || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length
          || item.evidenceIds.length > 3 || new Set(item.evidenceIds).size !== item.evidenceIds.length) throw Error('Invalid stable feedback');
      if (!summary && !Object.hasOwn(scores, item.dimension)) throw Error('Unassessed dimension');
      if (summary && Object.hasOwn(item, 'dimension')) throw Error('Invalid summary');
      const evidence = item.evidenceIds.map(id => catalog.get(id))
        .map(e => e && ({userIndex:e.userIndex,quote:e.quote}));
      if (!assessment.evidenceValid(evidence, transcript)) throw Error('Unsupported evidence');
      const text = editorialText(item.text, evidence, summary ? 70 : 40, summary ? 600 : 320);
      if (!text || /[\u0000-\u001f\u007f]/.test(text)) throw Error('Empty or invalid prose');
      const key = text.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen.has(key)) throw Error('Repeated feedback');
      seen.add(key);
      return {text,evidence};
    }
    function list(name, maximum) {
      const items = parsed[name];
      if (!Array.isArray(items) || items.length > maximum) throw Error('Unbounded stable feedback');
      return items.map(item => {
        const finding = {...prose(item),dimension:item.dimension};
        if (name !== 'recommendations') {
          findingEvidence[name].push(finding);
          byDimension[item.dimension] ||= {strengths:[],improvements:[]};
          byDimension[item.dimension][name].push(finding.text);
        }
        return finding.text;
      });
    }
    const strengths = list('strengths', 3), improvements = list('improvements', 3);
    const recommendations = list('recommendations', 2);
    const summary = prose(parsed.summary, true).text;
    return {style:STYLE,strengths,improvements,recommendations,summary,byDimension,findingEvidence};
  } catch (_) { return null; }
}

module.exports = {STYLE,validate};
