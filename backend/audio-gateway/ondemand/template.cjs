// Generates a standard CloudFormation template from the reviewed host scripts.
const fs=require('fs');
const ref=x=>({Ref:x}),att=(x,a)=>({'Fn::GetAtt':[x,a]}),sub=x=>({'Fn::Sub':x});
function build(){
 const parameters={};
 for(const name of ['VpcId','SubnetId','CloudFrontSecurityGroupId','ImageUri','RepositoryArn','SourceUri','SourceArn','SourceSha256','SttTableName','SttTableArn','SessionsTableName','SessionsTableArn','DeletionsTableName','DeletionsTableArn','VocabularyManifest','HealthUrl'])parameters[name]={Type:'String'};
 parameters.ImageId={Type:'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',Default:'/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64'};
 parameters.VpcId.Type='AWS::EC2::VPC::Id';parameters.SubnetId.Type='AWS::EC2::Subnet::Id';parameters.CloudFrontSecurityGroupId.Type='AWS::EC2::SecurityGroup::Id';
 parameters.ImageUri.AllowedPattern='^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/qlue-audio-gateway@sha256:[a-f0-9]{64}$';
 parameters.SourceSha256.AllowedPattern='^[a-f0-9]{64}$';
 parameters.SourceUri.AllowedPattern='^s3://[a-z0-9.-]+/[a-zA-Z0-9/._-]+$';
 for(const key of ['SttTableName','SessionsTableName','DeletionsTableName'])parameters[key].AllowedPattern='^[A-Za-z0-9_.-]{3,255}$';
 const statement=(Action,Resource,rest={})=>({Effect:'Allow',Action,Resource,...rest});
 const assume=service=>({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:service},Action:'sts:AssumeRole'}]});
 const tableWrites=['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'];
 const instanceArn=sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Host}');
 const hostStatements=[
  statement(['transcribe:StartStreamTranscription'],'*',{Condition:{StringEquals:{'aws:RequestedRegion':'us-east-1'}}}),
  statement(['transcribe:GetVocabulary'],sub('arn:${AWS::Partition}:transcribe:us-east-1:${AWS::AccountId}:vocabulary/qlue-public-*')),
  statement(tableWrites,ref('SttTableArn')),
  statement(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[ref('SessionsTableArn'),ref('DeletionsTableArn')]),
  statement(['ecr:GetAuthorizationToken'],'*'),
  statement(['ecr:BatchCheckLayerAvailability','ecr:GetDownloadUrlForLayer','ecr:BatchGetImage'],ref('RepositoryArn')),
  statement(['s3:GetObject'],ref('SourceArn')),
  statement(['logs:CreateLogStream','logs:PutLogEvents'],att('Logs','Arn')),
  // Tag condition limits self-stop without a circular Host -> HostRole -> Host.
  statement(['ec2:StopInstances'],sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/*'),{Condition:{StringEquals:{'ec2:ResourceTag/QlueAudioHost':sub('${AWS::StackName}')}}})
 ];
 let script=fs.readFileSync(__dirname+'/install.sh','utf8').replace('{{IDLE_CODE}}',fs.readFileSync(__dirname+'/idle-stop.py','utf8'));
 const values={SOURCE_URI:ref('SourceUri'),SOURCE_SHA:ref('SourceSha256'),STT_TABLE:ref('SttTableName'),SESSIONS_TABLE:ref('SessionsTableName'),DELETIONS_TABLE:ref('DeletionsTableName'),VOCABULARY:ref('VocabularyManifest'),IMAGE:ref('ImageUri'),REGISTRY:sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com'),LOGS:ref('Logs')};
 const segments=script.split(/(\{\{[A-Z_]+\}\})/g).map(v=>v.startsWith('{{')?values[v.slice(2,-2)]:v);if(segments.includes(undefined))throw Error('Unresolved user data');
 return {AWSTemplateFormatVersion:'2010-09-09',Description:'Qlue audio: wake on owned interview demand; stop after five idle minutes; no load balancer or idle compute.',Parameters:parameters,Rules:{RegionGuard:{Assertions:[{Assert:{'Fn::Equals':[ref('AWS::Region'),'us-east-1']},AssertDescription:'Audio sessions and technical vocabularies must remain in us-east-1.'}]}},Resources:{
  Logs:{Type:'AWS::Logs::LogGroup',Properties:{RetentionInDays:7}},
  WakeLogs:{Type:'AWS::Logs::LogGroup',Properties:{LogGroupName:sub('/aws/lambda/${AWS::StackName}-wake'),RetentionInDays:7}},
  HostSecurityGroup:{Type:'AWS::EC2::SecurityGroup',Properties:{VpcId:ref('VpcId'),GroupDescription:'Qlue audio: account CloudFront VPC origins only; no SSH',SecurityGroupIngress:[{IpProtocol:'tcp',FromPort:8080,ToPort:8080,SourceSecurityGroupId:ref('CloudFrontSecurityGroupId')}],SecurityGroupEgress:[{IpProtocol:'tcp',FromPort:443,ToPort:443,CidrIp:'0.0.0.0/0'},{IpProtocol:'tcp',FromPort:80,ToPort:80,CidrIp:'0.0.0.0/0'}]}},
  HostRole:{Type:'AWS::IAM::Role',Properties:{AssumeRolePolicyDocument:assume('ec2.amazonaws.com'),ManagedPolicyArns:[sub('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore')],Policies:[{PolicyName:'ServeOwnedAudioAndStopSelf',PolicyDocument:{Version:'2012-10-17',Statement:hostStatements}}]}},
  HostProfile:{Type:'AWS::IAM::InstanceProfile',Properties:{Roles:[ref('HostRole')]}},
  Host:{Type:'AWS::EC2::Instance',Properties:{ImageId:ref('ImageId'),InstanceType:'t4g.micro',CreditSpecification:{CPUCredits:'standard'},IamInstanceProfile:ref('HostProfile'),MetadataOptions:{HttpTokens:'required',HttpPutResponseHopLimit:1},Monitoring:false,InstanceInitiatedShutdownBehavior:'stop',NetworkInterfaces:[{DeviceIndex:'0',AssociatePublicIpAddress:true,SubnetId:ref('SubnetId'),GroupSet:[ref('HostSecurityGroup')]}],BlockDeviceMappings:[{DeviceName:'/dev/xvda',Ebs:{Encrypted:true,VolumeSize:8,VolumeType:'gp3',DeleteOnTermination:true}}],Tags:[{Key:'Name',Value:sub('${AWS::StackName}-host')},{Key:'QlueAudioHost',Value:sub('${AWS::StackName}')}],UserData:{'Fn::Base64':{'Fn::Join':['',segments]}}}},
  Origin:{Type:'AWS::CloudFront::VpcOrigin',Properties:{VpcOriginEndpointConfig:{Name:sub('${AWS::StackName}-origin'),Arn:instanceArn,HTTPPort:8080,HTTPSPort:443,OriginProtocolPolicy:'http-only'}}},
  WakeRole:{Type:'AWS::IAM::Role',Properties:{AssumeRolePolicyDocument:assume('lambda.amazonaws.com'),Policies:[{PolicyName:'WakeOneHostForOwnedInterview',PolicyDocument:{Version:'2012-10-17',Statement:[statement(['logs:CreateLogStream','logs:PutLogEvents'],att('WakeLogs','Arn')),statement(['ec2:DescribeInstances'],'*'),statement(['ec2:StartInstances'],instanceArn),statement(['dynamodb:GetItem'],[ref('SttTableArn'),ref('SessionsTableArn'),ref('DeletionsTableArn')]),statement(['dynamodb:UpdateItem'],ref('SttTableArn'))]}}]}},
  Wake:{Type:'AWS::Lambda::Function',DependsOn:'WakeLogs',Properties:{FunctionName:sub('${AWS::StackName}-wake'),Runtime:'python3.13',Architectures:['arm64'],Handler:'index.handler',Timeout:12,MemorySize:128,Role:att('WakeRole','Arn'),Environment:{Variables:{INSTANCE_ID:ref('Host'),STT_SESSIONS_TABLE:ref('SttTableName'),SESSIONS_TABLE:ref('SessionsTableName'),DELETION_JOBS_TABLE:ref('DeletionsTableName'),HEALTH_URL:ref('HealthUrl')}},Code:{ZipFile:fs.readFileSync(__dirname+'/wake.py','utf8')}}},
  WakeAsync:{Type:'AWS::Lambda::EventInvokeConfig',Properties:{FunctionName:ref('Wake'),Qualifier:'$LATEST',MaximumEventAgeInSeconds:60,MaximumRetryAttempts:0}}
 },Outputs:{HostId:{Value:ref('Host')},HostPrivateDns:{Value:att('Host','PrivateDnsName')},OriginId:{Value:att('Origin','Id')},WakeArn:{Value:att('Wake','Arn')},LogsName:{Value:ref('Logs')}}};
}
module.exports={build};
if(require.main===module)process.stdout.write(JSON.stringify(build(),null,2));
