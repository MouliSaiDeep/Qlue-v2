// Convert CloudFormation short-form intrinsics without changing their meaning.
const yaml = require('../backend/node_modules/js-yaml');
const tags = ['Ref','Sub','GetAtt','Join','Select','Split','Not','Equals','And','Or','If','FindInMap','Base64','ImportValue','Condition','GetAZs','Cidr','Transform'];
const types = tags.flatMap(tag => ['scalar','sequence','mapping'].map(kind => new yaml.Type('!'+tag, {
  kind, construct: value => tag === 'Ref' || tag === 'Condition' ? {[tag]:value} :
    {['Fn::'+tag]: tag === 'GetAtt' && typeof value === 'string' ? value.split('.') : value}
})));
module.exports = text => yaml.safeLoad(text, {schema:yaml.Schema.create(types)});
