// External DynamoDB simulator for real session/transcript/input/termination code.
// Evaluates the expressions those models emit; never replaces the models.
const clone = value => value === undefined ? undefined : structuredClone(value);
const conditional = () => Object.assign(new Error('conditional write lost'), {
  name: 'ConditionalCheckFailedException',
  CancellationReasons: [{Code:'ConditionalCheckFailed'}]
});
function sessionMemory() {
  const tables = new Map(), commands = [];
  const table = name => { if(!tables.has(name)) tables.set(name,new Map()); return tables.get(name); };
  const key = row => row.transcriptId || row.sessionId || row.userId;
  function check(p) {
    const row = table(p.TableName).get(key(p.Key || p.Item));
    const expr = p.ConditionExpression || '', v=p.ExpressionAttributeValues || {};
    for(const [,field] of expr.matchAll(/attribute_not_exists\((\w+)\)/g)) {
      if(row?.[field] !== undefined && !expr.includes(' OR ')) throw conditional();
    }
    for(const [,field] of expr.matchAll(/attribute_exists\((\w+)\)/g)) if(row?.[field] === undefined) throw conditional();
    for(const [,field,op,value] of expr.matchAll(/(\w+)\s*(=|<>)\s*(:\w+)/g)) {
      if(op==='=' ? row?.[field] !== v[value] : row?.[field] === v[value]) throw conditional();
    }
  }
  function mutate(p,type) {
    const t=table(p.TableName), id=key(p.Key || p.Item);
    if(type==='Put') {t.set(id,clone(p.Item));return {};}
    if(type==='Delete') {t.delete(id);return {};}
    const row=clone(t.get(id)), v=p.ExpressionAttributeValues || {};
    let expr=p.UpdateExpression;
    expr=expr.replace(/(\w+)\s*=\s*if_not_exists\((\w+),\s*(:\w+)\)\s*\+\s*(:\w+)/g,(_,field,prior,zero,inc)=>{
      row[field]=(row[prior] ?? v[zero])+v[inc];return '';
    });
    for(const [,field,value] of expr.split(' REMOVE ')[0].matchAll(/(\w+)\s*=\s*(:\w+)/g)) row[field]=clone(v[value]);
    for(const field of (expr.split(' REMOVE ')[1] || '').split(',').map(x=>x.trim())) delete row[field];
    t.set(id,row); return {Attributes:clone(row)};
  }
  async function send(command) {
    commands.push(command);const p=command.input,type=command.constructor.name.replace('Command','');
    if(type==='Get') return {Item:clone(table(p.TableName).get(key(p.Key)))};
    if(type==='Query') return {Items:[...table(p.TableName).values()].filter(row =>
      (!p.ExpressionAttributeValues?.[':sid'] || row.sessionId===p.ExpressionAttributeValues[':sid']) &&
      (!p.ExpressionAttributeValues?.[':uid'] || row.userId===p.ExpressionAttributeValues[':uid']))
      .sort((a,b)=>(p.ScanIndexForward===false?-1:1)*((a.turnIndex||0)-(b.turnIndex||0)))
      .slice(0,p.Limit || Infinity).map(clone)};
    if(type==='TransactWrite') {
      for(const op of p.TransactItems) check(Object.values(op)[0]);
      for(const op of p.TransactItems) if(!op.ConditionCheck) mutate(Object.values(op)[0],Object.keys(op)[0]);
      return {};
    }
    check(p);return mutate(p,type);
  }
  return {send,commands,table};
}
module.exports={sessionMemory};
