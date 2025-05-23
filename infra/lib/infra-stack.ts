import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as timestream from 'aws-cdk-lib/aws-timestream';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1) S3 bucket for raw log storage
    const rawLogsBucket = new s3.Bucket(this, 'RawLogsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2) DynamoDB table for parsed metrics
    const metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      partitionKey: { name: 'tickerSymbol', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'timestamp',    type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3) Timestream database
    const tsDatabase = new timestream.CfnDatabase(this, 'TimestreamDB', {
      databaseName: 'LambdaPulseDB',
    });

    // 4) Timestream table
    const tsTable = new timestream.CfnTable(this, 'TimestreamTable', {
      databaseName: tsDatabase.ref,
      tableName: 'LambdaPulseMetrics',
      retentionProperties: {
        MemoryStoreRetentionPeriodInHours: '24',
        MagneticStoreRetentionPeriodInDays: '7',
      },
    });
    tsTable.addDependency(tsDatabase);

    // 5) ETL Lambda: processes incoming Firehose records
    const etlLambda = new lambda.Function(this, 'EtlFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'etl-handler.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
      environment: {
        METRICS_TABLE: metricsTable.tableName,
        TS_DATABASE:   tsDatabase.ref,
        TS_TABLE:      tsTable.tableName!,
      },
    });

    // Permissions for ETL Lambda
    metricsTable.grantWriteData(etlLambda);
    etlLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['timestream:WriteRecords'],
      resources: [
        `arn:${cdk.Aws.PARTITION}:timestream:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}` +
        `:database/${tsDatabase.ref}/table/${tsTable.tableName}`
      ],
    }));
    etlLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['timestream:DescribeEndpoints'],
      resources: ['*'],
    }));

    // 6) IAM Role for Firehose (to write to S3 & invoke Lambda)
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    rawLogsBucket.grantWrite(firehoseRole);
    etlLambda.grantInvoke(firehoseRole);

    // 7) Kinesis Data Firehose delivery stream with ETL processor
    new firehose.CfnDeliveryStream(this, 'LogsDeliveryStream', {
      deliveryStreamName: 'LambdaPulseLogsStream',
      extendedS3DestinationConfiguration: {
        bucketArn: rawLogsBucket.bucketArn,
        roleArn:   firehoseRole.roleArn,
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 5 },
        processingConfiguration: {
          enabled: true,
          processors: [{
            type: 'Lambda',
            parameters: [{
              parameterName: 'LambdaArn',
              parameterValue: etlLambda.functionArn,
            }],
          }],
        },
      },
    });

    // 8) Primary processor Lambda (root GET / health-check)
    const processor = new lambda.Function(this, 'ProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
    });

    // 9) Query-Latest Lambda (for /metrics/latest)
    const queryLatestLambda = new lambda.Function(this, 'QueryLatestFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'query-latest.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TS_DATABASE: tsDatabase.ref,
        TS_TABLE:    tsTable.tableName!,
      },
    });

    // Permissions for QueryLatestFunction
    queryLatestLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['timestream:Select'],
      resources: [
        `arn:${cdk.Aws.PARTITION}:timestream:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}` +
        `:database/${tsDatabase.ref}/table/${tsTable.tableName}`
      ],
    }));
    queryLatestLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['timestream:DescribeEndpoints'],
      resources: ['*'],
    }));

    // 10) API Gateway with explicit routes
    const api = new apigateway.RestApi(this, 'LambdaPulseApi', {
         restApiName: 'LambdaPulse Service',
         defaultCorsPreflightOptions: {
           allowOrigins: apigateway.Cors.ALL_ORIGINS,       // or:
           // allowOrigins: ['http://localhost:3000', 'http://10.120.0.184:3000'],
           allowMethods: apigateway.Cors.ALL_METHODS,       // GET, POST, OPTIONS, etc.
         },
      });
    

    // 10a) Root GET → processor
    api.root.addMethod('GET', new apigateway.LambdaIntegration(processor));

    // 10b) /metrics/latest → queryLatestLambda
    const metrics = api.root.addResource('metrics');
    metrics
      .addResource('latest')
      .addMethod('GET', new apigateway.LambdaIntegration(queryLatestLambda));

    // 11) Output the Base API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base URL of the LambdaPulse API',
    });
  }
}
