// Legacy sessions without answer metadata remain eligible. Explicitly empty or
// discarded sessions must not be revived by a delayed feedback delivery.
function eligible(session) {
  return !!session && session.discarded !== true && session.feedbackExpected !== false && session.answeredCount !== 0;
}
function parentCheck(event) {
  return {
    ConditionExpression: 'attribute_exists(sessionId) AND userId = :feedbackUser'
      + ' AND (attribute_not_exists(discarded) OR discarded <> :feedbackTrue)'
      + ' AND (attribute_not_exists(feedbackExpected) OR feedbackExpected <> :feedbackFalse)'
      + ' AND (attribute_not_exists(answeredCount) OR answeredCount <> :feedbackZero)'
      + (event.attemptId ? ' AND feedbackAttemptId = :feedbackAttempt' : ' AND attribute_not_exists(feedbackAttemptId)'),
    ExpressionAttributeValues: { ':feedbackUser': event.userId, ':feedbackTrue': true,
      ':feedbackFalse': false, ':feedbackZero': 0, ...(event.attemptId ? { ':feedbackAttempt': event.attemptId } : {}) }
  };
}
module.exports = { eligible, parentCheck };
