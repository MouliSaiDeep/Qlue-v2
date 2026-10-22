module.exports=(answerId='a',withEvidenceGap=false)=>({
 summary:'Your final revised introduction connects your engineering background with a tested API project and a clear interest in backend work. You describe relevant experience in an understandable sequence. This review focuses on what you actually explained in the accepted answer.',
 criteria:['relevance','evidence','structure','clarity'].map((criterionId,i)=>({criterionId,answerId,evidenceId:'e1',
  strength:['You connect your engineering background to the question.','You describe building and testing a relevant API project.','You organize your introduction around background and work.','You explain the purpose of your work in understandable terms.'][i],
  gap:withEvidenceGap&&i===1?'The API example does not describe the outcome of your work.':'',nextStep:withEvidenceGap&&i===1?'Describe one authentication test and its result.':'',reason:['Your background and project directly address the introduction prompt.','Your API project provides a concrete example of relevant work.','The answer connects your background, work and future direction.','The content is understandable without requiring elaborate vocabulary.'][i]}))
});
