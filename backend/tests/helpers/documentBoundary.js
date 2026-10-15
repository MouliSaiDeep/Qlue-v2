// Deterministic external DynamoDB boundary. Application models and handlers
// remain real. Implements only the documented commands/expressions used here.
const clone=x=>x===undefined?undefined:structuredClone(x);
const split=s=>{let depth=0,start=0,out=[];for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){out.push(s.slice(start,i));start=i+1;}}out.push(s.slice(start));return out.map(x=>x.trim());};
class DocumentBoundary {
  constructor(){this.rows=new Map();this.calls=[];this.beforeSend=null;}
  key(table,item){const name=table.includes('deletion')||table.endsWith('users')?'userId':table.includes('usage')?'userId':table.includes('resume')?'resumeId':table.includes('transcript')?'transcriptId':table.includes('feedback')?'feedbackId':table.includes('connection')?'connectionId':table.includes('support')?'ticketId':table.includes('analysis')?'jobId':'sessionId';return JSON.stringify([table,item[name],table.includes('usage')?item.date:null]);}
  seed(table,row){this.rows.set(this.key(table,row),clone(row));return row;}
  get(table,key){return clone(this.rows.get(this.key(table,key)));}
  expression(text,row={},input={}) {
    const tokens=(text||'').match(/#[\w]+|:[\w]+|[\w.]+|<>|<=|>=|[=<>+(),]/g)||[];let i=0;
    const path=t=>(input.ExpressionAttributeNames?.[t]||t).split('.');
    const attr=t=>path(t).reduce((v,k)=>v?.[k],row);
    const atom=()=>{
      const token=tokens[i++];
      if(token==='('){const v=or();if(tokens[i++]!==')')throw new Error('Invalid condition');return v;}
      if(['attribute_exists','attribute_not_exists','if_not_exists'].includes(token)){
        i++;const field=tokens[i++];let fallback;
        if(tokens[i]===','){i++;fallback=atom();}i++;
        return token==='attribute_exists'?attr(field)!==undefined:token==='attribute_not_exists'?attr(field)===undefined:attr(field)??fallback;
      }
      return token?.startsWith(':')?input.ExpressionAttributeValues?.[token]:attr(token);
    };
    const compare=()=>{let left=atom();const op=tokens[i];
      if(op==='IN'){i+=2;const values=[];while(tokens[i]!==')'){values.push(atom());if(tokens[i]===',')i++;}i++;return values.includes(left);}
      if(['=','<>','<','>','<=','>=','+'].includes(op)){i++;const right=atom();return op==='='?left===right:op==='<>'?left!==right:op==='<'?left<right:op==='>'?left>right:op==='<='?left<=right:op==='>='?left>=right:left+right;}
      return left;};
    const and=()=>{let v=compare();while(tokens[i]==='AND'){i++;const b=compare();v=v&&b;}return v;};
    const or=()=>{let v=and();while(tokens[i]==='OR'){i++;const b=and();v=v||b;}return v;};
    return or();
  }
  apply(type,input) {
    const old=this.get(input.TableName,input.Key||input.Item);
    if(input.ConditionExpression&&!this.expression(input.ConditionExpression,old,input)){const e=new Error('Condition failed');e.name='ConditionalCheckFailedException';throw e;}
    if(type==='ConditionCheck')return {};
    if(type==='Put'){this.seed(input.TableName,input.Item);return {};}
    if(type==='Delete'){this.rows.delete(this.key(input.TableName,input.Key));return {};}
    const row={...old,...input.Key};
    const assign=(name,value)=>{const parts=name.split('.').map(p=>input.ExpressionAttributeNames?.[p]||p);let target=row;for(const p of parts.slice(0,-1))target=target[p]||=( {} );if(value===undefined)delete target[parts.at(-1)];else target[parts.at(-1)]=value;};
    const parts=input.UpdateExpression.split(/\b(SET|ADD|REMOVE)\b/).slice(1);
    for(let j=0;j<parts.length;j+=2)for(const clause of split(parts[j+1])){
      if(!clause)continue;
      if(parts[j]==='SET'){const [name,...value]=clause.split('=');assign(name.trim(),this.expression(value.join('='),row,input));}
      else if(parts[j]==='REMOVE')assign(clause,undefined);
      else {const [name,value]=clause.split(/\s+/);assign(name,(this.expression(name,row,input)||0)+this.expression(value,row,input));}
    }
    this.seed(input.TableName,row);return {Attributes:clone(row)};
  }
  async send(command){this.calls.push(command);await this.beforeSend?.(command);const input=command.input;const type=command.constructor.name.replace('Command','');
    if(type==='Get')return {Item:this.get(input.TableName,input.Key)};
    if(type==='Query'||type==='Scan'){let rows=[...this.rows.entries()].filter(([key])=>JSON.parse(key)[0]===input.TableName).map(([,row])=>clone(row));rows=rows.filter(row=>(!input.KeyConditionExpression||this.expression(input.KeyConditionExpression,row,input))&&(!input.FilterExpression||this.expression(input.FilterExpression,row,input)));return {Items:rows};}
    if(type==='TransactWrite') {const snapshot=new Map(this.rows);try {for(const item of input.TransactItems){const [name,params]=Object.entries(item)[0];this.apply(name,params);}}catch(error){this.rows=snapshot;error.name='TransactionCanceledException';error.CancellationReasons=[{Code:'ConditionalCheckFailed'}];throw error;}return {};}
    if(type==='BatchWrite'){for(const [table,items]of Object.entries(input.RequestItems))for(const item of items){if(item.DeleteRequest)this.apply('Delete',{TableName:table,Key:item.DeleteRequest.Key});else this.apply('Put',{TableName:table,Item:item.PutRequest.Item});}return {UnprocessedItems:{}};}
    return this.apply(type,input);
  }
}
module.exports={DocumentBoundary};
