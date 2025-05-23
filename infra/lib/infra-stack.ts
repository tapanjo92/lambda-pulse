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

    // 3) Timestream database for time-series data
    const tsDatabase = new timestream.CfnDatabase(this, 'TimestreamDB', {
      databaseName: 'LambdaPulseDB',
    });

    // 4) Timestream table for metrics
    const tsTable = new timestream.CfnTable(this, 'TimestreamTable', {
      databaseName: tsDatabase.ref,
      tableName: 'LambdaPulseMetrics',
      retentionProperties: {
        MemoryStoreRetentionPeriodInHours: '24',
        MagneticStoreRetentionPeriodInDays: '7',
      },
    });
    tsTable.addDependsOn(tsDatabase); // ensure DB exists first

    // 5) ETL Lambda: processes incoming Firehose records
    const etlLambda = new lambda.Function(this, 'EtlFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'etl-handler.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
      environment: {
        METRICS_TABLE: metricsTable.tableName,
        TS_DATABASE: tsDatabase.ref,
        TS_TABLE: 'LambdaPulseMetrics',
      },
    });

    // Grant ETL Lambda write permissions
    metricsTable.grantWriteData(etlLambda);
    etlLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['timestream:WriteRecords'],
      resources: [
        cdk.Arn.format({
          service: 'timestream',
          resource: 'database',
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
          resourceName: `${tsDatabase.ref}/table/LambdaPulseMetrics`,
        }, this),
      ],
    }));

    // 6) IAM Role for Firehose (to write to S3 and invoke Lambda)
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
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 5,
        },
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

    // 8) Primary processor Lambda (e.g., API handler)
    const processor = new lambda.Function(this, 'ProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/dist')),
    });

    // 9) API Gateway REST API fronting the processor Lambda
    const api = new apigateway.LambdaRestApi(this, 'LambdaPulseApi', {
      handler: processor,
      proxy: true,
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Invoke URL for the LambdaPulse API',
    });
  }
}
