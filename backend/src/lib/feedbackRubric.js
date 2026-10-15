// Content rubrics and practice suggestions, not claims about observed delivery.
const MODULE_DIMENSIONS = {
  RESUME:['Technical Accuracy','Clarity','Use of Examples'],
  JD:['Role Alignment','Technical Accuracy','Use of Examples'],
  HR:['Problem Solving','Communication','Self Awareness'],
  WEBSITE:['Comprehension','Critical Thinking','Concept Retention'],
  INTRO:['Clarity','Structure','Confidence'],
  SELF_INTRO:['Clarity','Structure','Confidence']
};
const FINDINGS = {
  EXAMPLE:'The transcript provides a concrete example',
  BACKGROUND:'The transcript states relevant background',
  ROLE_GOAL:'The transcript states a role or career goal',
  ADD_EXAMPLE:'Add a specific example to this part of the answer',
  ADD_IMPACT:'Explain the result or impact of this example',
  ORGANIZE:'Organize this content into background, evidence and goal',
  DIRECT_CONTENT:'The answer presents a clear point relevant to the question',
  EXPLAIN_POINT:'State the main point first, then explain how the details support it',
  LOGICAL_SEQUENCE:'The answer connects background, supporting experience and a goal',
  TECHNICAL_REASONING:'The answer explains a technical mechanism with supporting reasoning',
  EXPLAIN_MECHANISM:'Explain how this mechanism works and state its assumptions or limits',
  ROLE_LINK:'The answer connects experience or skills to a requirement of the role',
  LINK_ROLE:'Connect this experience to a specific requirement of the role',
  CONCRETE_EXAMPLE:'The answer describes a specific action or project',
  ACTION_RESULT:'Describe your own action and its result in this example',
  PROBLEM_APPROACH:'The answer connects a problem to an approach for solving it',
  COMPARE_OPTIONS:'Explain the alternatives, why you chose this approach and how you checked the result',
  REFLECTION:'The answer identifies a lesson learned from experience',
  APPLY_LESSON:'Explain what you learned and how you would apply that lesson next time',
  CONCEPT_EXPLANATION:'The answer explains the meaning or mechanism of the concept',
  EXPLAIN_CONCEPT:'Explain the concept in your own words and give a concrete application',
  REASONED_TRADEOFF:'The answer supports a conclusion by discussing a trade-off or limitation',
  TEST_CONCLUSION:'State the assumptions, compare an alternative and explain what evidence would test the conclusion',
  CONCEPT_APPLICATION:'The answer connects a recalled concept to an application',
  RECALL_APPLY:'Restate the key concept from memory and demonstrate it with an application'
};
function rubric(description, practice, strengths, improvements) {
  return {description,practice,strengths,improvements};
}
const RUBRICS = {
  Clarity:rubric('How clearly the received text states a relevant main point and explains its details.',
    'Practice answering with one direct point, one supporting example and one takeaway.', ['DIRECT_CONTENT','EXAMPLE'],['EXPLAIN_POINT','ADD_EXAMPLE']),
  Structure:rubric('How the answer organizes background, supporting experience and a goal into a logical sequence.',
    'Outline background → relevant project or achievement → goal before your next introduction.', ['LOGICAL_SEQUENCE','BACKGROUND','ROLE_GOAL'],['ORGANIZE','ADD_IMPACT']),
  Confidence:rubric('Vocal confidence requires recorded audio; it cannot be measured from recognized words alone.',
    '',[],[]),
  'Technical Accuracy':rubric('Whether the explanation gives a technically sound mechanism, reasoning and appropriate limitations.',
    'Choose one concept; explain how it works, its assumptions and a test case that checks your explanation.', ['TECHNICAL_REASONING','CONCRETE_EXAMPLE'],['EXPLAIN_MECHANISM','ADD_EXAMPLE']),
  'Use of Examples':rubric('Whether a specific example demonstrates your own action and an observable result.',
    'Prepare one example as situation → your action → result; use real measures where you have them.', ['CONCRETE_EXAMPLE','EXAMPLE'],['ACTION_RESULT','ADD_IMPACT','ADD_EXAMPLE']),
  'Role Alignment':rubric('How explicitly your experience and skills connect to the requirements of the target role.',
    'Pick one role requirement and connect it to a project, your contribution and its result.', ['ROLE_LINK','ROLE_GOAL'],['LINK_ROLE','ADD_EXAMPLE']),
  'Problem Solving':rubric('How the answer explains the problem, approach, alternatives and checks on the result.',
    'Practice a problem → alternatives → decision → verification example.', ['PROBLEM_APPROACH','REASONED_TRADEOFF'],['COMPARE_OPTIONS','ADD_IMPACT']),
  Communication:rubric('How clearly the text conveys a relevant point and supports it for the intended audience.',
    'Explain one project to a non-specialist using a main point, necessary context and a result.', ['DIRECT_CONTENT','EXAMPLE'],['EXPLAIN_POINT','ADD_EXAMPLE']),
  'Self Awareness':rubric('Whether the answer reflects on your contribution, limitations and lessons learned.',
    'Prepare an experience, your responsibility, a lesson learned and what you would change next time.', ['REFLECTION','BACKGROUND'],['APPLY_LESSON','ADD_EXAMPLE']),
  Comprehension:rubric('Whether the answer explains a concept accurately and connects it to its meaning or use.',
    'Explain one concept in your own words and demonstrate it with a concrete application.', ['CONCEPT_EXPLANATION','CONCRETE_EXAMPLE'],['EXPLAIN_CONCEPT','ADD_EXAMPLE']),
  'Critical Thinking':rubric('Whether the answer supports a conclusion with reasoning, alternatives and limitations.',
    'Choose a claim; list its assumptions, compare an alternative and describe evidence that would test it.', ['REASONED_TRADEOFF','PROBLEM_APPROACH'],['TEST_CONCLUSION','COMPARE_OPTIONS']),
  'Concept Retention':rubric('Whether the answer recalls the key concept and applies it in a relevant context.',
    'Restate the concept from memory, apply it to a new example, then check against your source.', ['CONCEPT_APPLICATION','CONCEPT_EXPLANATION'],['RECALL_APPLY','ADD_EXAMPLE'])
};
function dimensionsFor(moduleType) {return MODULE_DIMENSIONS[moduleType] || ['performance'];}
function rubricFor(dimension) {
  return RUBRICS[dimension] || rubric(`Content assessment of ${dimension} in the received transcript.`,
    'Review the question, state your main point and support it with a specific example and result.',
    ['EXAMPLE','BACKGROUND','ROLE_GOAL'],['ADD_EXAMPLE','ADD_IMPACT','ORGANIZE']);
}
module.exports = {MODULE_DIMENSIONS,FINDINGS,dimensionsFor,rubricFor};
