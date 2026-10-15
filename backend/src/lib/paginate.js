const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Drains every page of a DynamoDB Query.
 *
 * BE-BUG #18 FIX: the dashboard aggregate handlers (summary / module stats /
 * score trends) read only `result.Items` from a single `send`, so any user
 * whose sessions exceed one 1MB Query page had their totals, averages and
 * radar silently computed from a truncated subset. This helper follows
 * `LastEvaluatedKey` until the query is exhausted so aggregates span all pages.
 *
 * A `maxPages` ceiling bounds worst-case fan-out (a runaway/hot partition can
 * not spin forever); it is generous enough that no real user hits it.
 *
 * @param {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient} docClient
 * @param {object} params  QueryCommand params WITHOUT ExclusiveStartKey.
 * @param {{ maxPages?: number }} [options]
 * @returns {Promise<object[]>} every matching item across all pages
 */
async function queryAllItems(docClient, params, { maxPages = 100 } = {}) {
  const items = [];
  let exclusiveStartKey;
  let pages = 0;

  do {
    const page = await require('./deadline').sendBounded(docClient,new QueryCommand({
      ...params,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    }));
    if (page.Items && page.Items.length) items.push(...page.Items);
    exclusiveStartKey = page.LastEvaluatedKey;
    pages += 1;
  } while (exclusiveStartKey && pages < maxPages);

  return items;
}

module.exports = { queryAllItems };
