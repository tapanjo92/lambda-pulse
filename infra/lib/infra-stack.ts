import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as timestream from 'aws-cdk-lib/aws-timestream';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1) S3 bucket
    const rawLogsBucket = new s3.Bucket(this, 'RawLogsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2) DynamoDB table
    const metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      partitionKey: { name: 'tenantFn', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3) Timestream database
    const tsDatabase = new timestream.CfnDatabase(this, 'TimestreamDB', {
      databaseName: 'LambdaPulseDB',
    });

    // 4) IAM Role for Firehose
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    rawLogsBucket.grantWrite(firehoseRole);

    // 5) Firehose Delivery Stream
    new firehose.CfnDeliveryStream(this, 'LogsDeliveryStream', {
      deliveryStreamName: 'LambdaPulseLogsStream',
      s3DestinationConfiguration: {
        bucketArn: rawLogsBucket.bucketArn,
        roleArn:   firehoseRole.roleArn,
      },
    });

    const processor = new lambda.Function(this, 'ProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
    });

    const api = new apigateway.LambdaRestApi(this, 'LambdaPulseApi', {
      handler: processor,
      proxy: true,             // routes ANY / to your Lambda
    });
    
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,          // e.g. https://xxxx.execute-api...
      description: 'Invoke URL for LambdaPulse API',
    });
    
  }
}

