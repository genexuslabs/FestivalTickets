import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import { GeneXusServerlessAngularAppProps } from './GeneXusServerlessAngularAppProps';
import {Rule, Schedule} from "aws-cdk-lib/aws-events";
import {LambdaFunction} from "aws-cdk-lib/aws-events-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs';
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
import * as rds from 'aws-cdk-lib/aws-rds';
import * as apprunner from '@aws-cdk/aws-apprunner-alpha';

import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { timeStamp } from "console";
import { Queue } from "aws-cdk-lib/aws-sqs";
// const { CreateMainVPC } = require('./gxapp-vpc');


const lambdaHandlerName =
  "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 3008;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";

export class GeneXusServerlessAngularApp extends Construct {
  appName: string;
  stageName: string;
  isDevEnv: boolean = true;
  vpc: ec2.Vpc;
  dbServer: rds.DatabaseInstance;
  iamUser: iam.User;
  DTicket: dynamodb.Table;
  DCache: dynamodb.Table;
  queueLambdaFunction: lambda.Function;
  cronLambdaFunction: lambda.Function;
  lambdaRole: iam.Role;
  securityGroup: ec2.SecurityGroup;
  accessKey: iam.CfnAccessKey;
  envVars: any = {};
  appRunner: apprunner.Service;

  constructor(
    scope: Construct,
    id: string,
    props: GeneXusServerlessAngularAppProps
  ) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    this.appName = props?.apiName || "";
    this.stageName = props?.stageName || "";

    if (this.appName.length == 0) {
      throw new Error("API Name cannot be empty");
    }

    if (this.stageName.length == 0) {
      throw new Error("Stage Name cannot be empty");
    }

    // WarmUp
    new cdk.CfnOutput(this, "AppName", {
      value: this.appName,
      description: "Application Name",
    });
    new cdk.CfnOutput(this, "StageName", {
      value: this.stageName,
      description: "Stage Name",
    });

    // -------------------------------
    // Lambda Role
    this.lambdaRoleCreate(props);

    // -------------------------------
    // IAM User and groups
    // -------------------------------
    this.iamUserCreate(props);
    const appGroup = new iam.Group(this, 'app-group-id', {
      groupName: `${this.appName}_${this.stageName}_appgroup`
    });
    appGroup.addUser(this.iamUser); 
    
    // Note: Maximum policy size of 2048 bytes exceeded for user
    const festGroup = new iam.Group(this, 'festival-group-id', {
      groupName: `${this.appName}_${this.stageName}_festgroup`
    });
    festGroup.addUser(this.iamUser);

    //----------------------------------
    // VPC
    //----------------------------------
    this.createVPC(props); 
    
    const DynamoGatewayEndpoint = this.vpc.addGatewayEndpoint('Dynamo-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB
    });
    
    // Security group
    this.securityGroup = new ec2.SecurityGroup(this, `rds-sg`, {
      vpc: this.vpc,
      allowAllOutbound: true
    });
    
    //---------------------------------
    // RDS - MySQL 8.0
    //---------------------------------
    this.securityGroup.connections.allowFrom( this.securityGroup, ec2.Port.tcp(3306));
    if (this.isDevEnv) {
      //Access from MyIP
      this.securityGroup.connections.allowFrom( ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535)); 
    }
    this.createDB(props);

    new cdk.CfnOutput(this, "DBEndPoint", {
      value: this.dbServer.dbInstanceEndpointAddress,
      description: "RDS MySQL Endpoint",
    });
    
    new cdk.CfnOutput(this, 'DBSecretName', {
      value: this.dbServer.secret?.secretName!,
      description: "RDS MySQL Secret Name",
    });

    // ---------------------------------
    // Dynamo
    this.createDynamo(props);
    this.DCache.grantReadWriteData( festGroup);
    this.DTicket.grantReadWriteData( festGroup);

    // new cdk.CfnOutput(this, 'DynamoDCacheTableName', { value: this.DCache.tableName });
    // new cdk.CfnOutput(this, 'DynamoDTicketTableName', { value: this.DTicket.tableName });
    
    // -------------------------------
    // SQS Ticket Queue
    // -------------------------------
    const ticketQueue = new sqs.Queue(this, `ticketqueue`, {
      queueName: `${this.appName}_${this.stageName}_ticketqueue`
    });
    new cdk.CfnOutput(this, "SQSTicketUrl", {
      value: ticketQueue.queueUrl,
      description: "SQS Ticket Url",
    });
    
    // -------------------------------
    // Environment variables
    this.envVars[`REGION`] = cdk.Stack.of(this).region;
    this.envVars[`GX_FESTIVALTICKETS_QUEUEURL`] = ticketQueue.queueUrl;
    this.envVars[`GX_DEFAULT_DB_URL`] = `jdbc:mysql://${this.dbServer.dbInstanceEndpointAddress}/festivaltickets?useSSL=false`;
    this.envVars[`GX_DEFAULT_USER_ID`] = this.dbServer.secret?.secretValueFromJson('username');
    this.envVars[`GX_DEFAULT_USER_PASSWORD`] = this.dbServer.secret?.secretValueFromJson('password');
    this.envVars[`GX_DYNAMODBDS_USER_ID`] = this.accessKey.ref;
    this.envVars[`GX_DYNAMODBDS_USER_PASSWORD`] = this.accessKey.attrSecretAccessKey;
    
    // ----------------------------------------
    // Backoffice
    // ----------------------------------------
    this.createBackoofice();
    
    new cdk.CfnOutput(this, 'Backoffice - Apprunner-url', {
      value: `https://${this.appRunner.serviceUrl}/com.festivaltickets.businesslogic.bohome`,
    });
    
    // -------------------------------
    // FestivalTickets Lambdas (SQS & CRON)
    this.createFestivalTicketsLambdas( props);

    new cdk.CfnOutput(this, "LambdaTicketProcess", {
      value: this.queueLambdaFunction.functionName,
      description: "Ticket Process Lambda Name",
    });

    new cdk.CfnOutput(this, "LambdaCron", {
      value: this.cronLambdaFunction.functionName,
      description: "Ticket Ruffle Lambda Cron",
    });
    
    // Some queue permissions
    ticketQueue.grantConsumeMessages(this.queueLambdaFunction);
    ticketQueue.grantSendMessages(festGroup);
    
    // Lambda queue trigger
    const eventSource = new lambdaEventSources.SqsEventSource(ticketQueue);
    this.queueLambdaFunction.addEventSource(eventSource);
    
    // -----------------------------------
    // Storage
    // -----------------------------------
    const storageBucket = new s3.Bucket(this, `${this.appName}-bucket`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: new s3.BlockPublicAccess({blockPublicAcls: false,blockPublicPolicy: false, restrictPublicBuckets:false }),
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      //accessControl: s3.BucketAccessControl.PUBLIC_READ
    });
    // storageBucket.grantPublicAccess();
    // storageBucket.grantPut(appGroup);
    storageBucket.grantPutAcl(appGroup);
    storageBucket.grantReadWrite(appGroup);
    

    new cdk.CfnOutput(this, "Storage-Bucket", {
      value: storageBucket.bucketName,
      description: "Storage - Bucket for Storage Service",
    });

    // -----------------------------
    // Backend services
    // -----------------------------
    const api = new apigateway.RestApi(this, `${this.appName}-apigw`, {
      description: `${this.appName} APIGateway Endpoint`,
      restApiName: this.appName,
      deployOptions: {
        stageName: this.stageName,
      },
      defaultCorsPreflightOptions: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    const lambdaFunctionName = `${this.appName}_${this.stageName}`;
    const lambdaFunction = new lambda.Function(this, `${this.appName}-function`, {
      environment: this.envVars,
      functionName: lambdaFunctionName,
      runtime: defaultLambdaRuntime,
      handler: lambdaHandlerName,
      code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"), //Empty sample package
      vpc: this.vpc,
      //allowPublicSubnet: true,
      role: this.lambdaRole,
      timeout: props?.timeout || lambdaDefaultTimeout,
      memorySize: props?.memorySize || lambdaDefaultMemorySize,
      description: `'${
        props?.apiDescription || this.appName
      }' Serverless Lambda function`,
      securityGroups: [this.securityGroup],
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    this.DCache.grantReadWriteData(lambdaFunction);
    this.DTicket.grantReadWriteData(lambdaFunction);
    lambdaFunction.grantInvoke(appGroup);

    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [
          `arn:aws:apigateway:${stack.region}::/restapis/${api.restApiId}*`,
        ],
      })
    );
    
    // -------------------------------------------------------------
    // Angular App Host
    // Maximum policy size of 2048 bytes exceeded for user
    // -------------------------------------------------------------
    
    const websitePublicBucket = new s3.Bucket(this, `${this.appName}-bucket-web`, {
      websiteIndexDocument: "index.html",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL
    });

    websitePublicBucket.grantPublicAccess();
    websitePublicBucket.grantReadWrite(appGroup);

    new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          effect: iam.Effect.ALLOW,
        }),
      ],
    });

    const rewriteEdgeFunctionResponse =
      new cloudfront.experimental.EdgeFunction(this, `${this.appName}EdgeLambda`, {
        functionName: `${this.appName}-${this.stageName}-EdgeLambda`,
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: rewriteEdgeLambdaHandlerName,
        code: lambda.Code.fromAsset("lambda"),
        description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
        logRetention: logs.RetentionDays.FIVE_DAYS        
      });

    rewriteEdgeFunctionResponse.grantInvoke(appGroup);
    rewriteEdgeFunctionResponse.addAlias("live", {});

    const originPolicy = new cloudfront.OriginRequestPolicy(
      this,
      `${this.appName}HttpOriginPolicy`,
      {
        //originRequestPolicyName: "GX-HTTP-Origin-Policy",
        comment: `${this.appName} Origin Http Policy`,
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
          "Accept",
          "Accept-Charset",
          "Accept-Language",
          "Content-Type",
          "GxTZOffset",
          "DeviceId",
          "DeviceType",
          "Referer"
        ),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        cookieBehavior: cloudfront.CacheCookieBehavior.all(),
      }
    );
    
    const certificate = props?.certificateARN
      ? acm.Certificate.fromCertificateArn(
          this,
          "Cloudfront Certificate",
          props?.certificateARN
        )
      : undefined;

    const webDistribution = new cloudfront.Distribution(
      this,
      `${this.appName}-cdn`,
      {
        comment: `${this.appName} Cloudfront Distribution`,
        domainNames: props?.webDomainName ? [props?.webDomainName] : undefined,
        certificate: certificate,
        defaultBehavior: {
          origin: new origins.S3Origin(websitePublicBucket),
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          edgeLambdas: [
            {
              functionVersion: rewriteEdgeFunctionResponse,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
            }
          ],
        },
      }
    );

    const apiDomainName = `${api.restApiId}.execute-api.${stack.region}.amazonaws.com`;

    const apiGatewayOrigin = new origins.HttpOrigin(apiDomainName, {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    });

    webDistribution.node.addDependency(api);

    webDistribution.addBehavior(`/${this.stageName}/*`, apiGatewayOrigin, {
      compress: true,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: originPolicy,
    });
    
    // ****************************************
    // Backend - Api gateway
    // ****************************************
    new cdk.CfnOutput(this, "ApiURL", {
      value: `https://${webDistribution.domainName}/${this.stageName}/`,
      description: "Backend - Services API URL (Services URL)",
    });


    // ****************************************
    // Frontend - Angular
    // ****************************************
    new cdk.CfnOutput(this, "Frontend-Bucket", {
      value: websitePublicBucket.bucketName,
      description: "Frontend - Bucket Name for Angular WebSite Deployment",
    });

    new cdk.CfnOutput(this, "Frontend-WebURL", {
      value: `https://${webDistribution.domainName}`,
      description: "Frontend - Website URL",
    });
    
    new cdk.CfnOutput(this, "Lambda - IAMRoleARN", {
      value: this.lambdaRole.roleArn,
      description: "IAM Role ARN",
    });

    new cdk.CfnOutput(this, "AccessKey", {
      value: this.accessKey.ref,
      description: "Access Key",
    });
    new cdk.CfnOutput(this, "AccessSecretKey", {
      value: this.accessKey.attrSecretAccessKey,
      description: "Access Secret Key",
    });
    
  }

  private iamUserCreate(props: GeneXusServerlessAngularAppProps){
    const stack = cdk.Stack.of(this);
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    this.iamUser = new iam.User(this, `${apiName}-user`);

    // Generic Policies
    // S3 gx-deploy will be used to deploy the app to aws
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
      })
    );
    // Grant access to all application lambda functions
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:*"],
        resources: [
          `arn:aws:lambda:${stack.region}:${stack.account}:function:${apiName}_*`,
        ],
      })
    );

    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [`arn:aws:apigateway:${stack.region}::/restapis*`],
      })
    );

    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [this.lambdaRole.roleArn],
      })
    );

    this.accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
      userName: this.iamUser.userName,
    });
  }

  private lambdaRoleCreate(props: GeneXusServerlessAngularAppProps){
    this.lambdaRole = new iam.Role(this, `lambda-role`, {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("apigateway.amazonaws.com"),
        new iam.ServicePrincipal("lambda.amazonaws.com"),
        new iam.ServicePrincipal("build.apprunner.amazonaws.com")
      ),
      description: "GeneXus Serverless Application Lambda Role",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaSQSQueueExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSAppRunnerServicePolicyForECRAccess"
        )
      ],
    });

  }

  private createDynamo(props: GeneXusServerlessAngularAppProps){
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    // TODO: Ver si en algún momento Gx implementa el cambio de nombre en tablas en dataviews
    // Partitionkey "id" por compatibilidad con cosmos db
    this.DCache = new dynamodb.Table( this, `DCache`, {
      tableName: `DCache`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    this.DTicket = new dynamodb.Table( this, `DTicket`, {
      tableName: `DTicket`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    this.DTicket.addGlobalSecondaryIndex({
      indexName: 'TicketCodeIndex',
      partitionKey: {name: 'DTicketCode', type: dynamodb.AttributeType.STRING},
      readCapacity: 1,
      writeCapacity: 1,
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.DTicket.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: {name: 'DEventId', type: dynamodb.AttributeType.NUMBER},
      sortKey: {name: 'DUserEmail', type: dynamodb.AttributeType.STRING},
      readCapacity: 1,
      writeCapacity: 1,
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
  private createFestivalTicketsLambdas(props: GeneXusServerlessAngularAppProps){
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    this.queueLambdaFunction = new lambda.Function(this, `TicketProcess`, {
      functionName: `${apiName}_${stageName}_TicketProcess`,
      environment: this.envVars,
      runtime: defaultLambdaRuntime,
      handler: "com.genexus.cloud.serverless.aws.handler.LambdaSQSHandler::handleRequest",
      code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"), //Empty sample package
      vpc: this.vpc,
      //allowPublicSubnet: true,
      role: this.lambdaRole,
      timeout: props?.timeout || lambdaDefaultTimeout,
      memorySize: props?.memorySize || lambdaDefaultMemorySize,
      description: `'${
        props?.apiDescription || apiName
      }' Queue Ticket Process Lambda function`,
      logRetention: logs.RetentionDays.ONE_WEEK,
      securityGroups: [this.securityGroup]
    });

    // Lambda CRON
    this.cronLambdaFunction = new lambda.Function(this, `CronLambda`, {
      functionName: `${apiName}_${stageName}_Cron`,
      environment: this.envVars,
      runtime: defaultLambdaRuntime,
      handler: "com.genexus.cloud.serverless.aws.handler.LambdaEventBridgeHandler::handleRequest",
      code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"), //Empty sample package
      vpc: this.vpc,
      //allowPublicSubnet: true,
      role: this.lambdaRole,
      timeout: props?.timeout || lambdaDefaultTimeout,
      memorySize: props?.memorySize || lambdaDefaultMemorySize,
      description: `'${
        props?.apiDescription || apiName
      }' Cron Process Lambda function`,
      logRetention: logs.RetentionDays.ONE_WEEK,
      securityGroups: [this.securityGroup]
    });
    //EventBridge rule which runs every five minutes
    const cronRule = new Rule(this, 'CronRule', {
      schedule: Schedule.expression('cron(0/10 * * * ? *)')
    })
    cronRule.addTarget(new LambdaFunction(this.cronLambdaFunction));
  }

  private createDB(props: GeneXusServerlessAngularAppProps){
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    const instanceIdentifier = `${apiName}-${stageName}-db`;

    this.dbServer = new rds.DatabaseInstance(this, `${apiName}-db`, {
      publiclyAccessible: this.isDevEnv,
      vpcSubnets: {
        onePerAz: true,
        subnetType: this.isDevEnv ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      vpc: this.vpc,
      port: 3306,
      databaseName: 'festivaltickets',
      allocatedStorage: 20,
      instanceIdentifier,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      securityGroups: [this.securityGroup],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      removalPolicy: this.isDevEnv ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    })
    if (this.isDevEnv){
      console.log(`** AZ ** ${this.vpc.availabilityZones.length}`);

      for(let i=0;i<this.vpc.availabilityZones.length;i++){
        this.dbServer.node.addDependency(this.vpc.publicSubnets[i].internetConnectivityEstablished);
      }
    }
  }

  private createBackoofice(){    
    const vpcConnector = new apprunner.VpcConnector(this, 'VpcConnector', {
      vpc: this.vpc,
      vpcSubnets: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      vpcConnectorName: `${this.appName}_${this.stageName}_VpcConnector`,
      securityGroups: [this.securityGroup]
    });

    this.appRunner = new apprunner.Service(this, 'BO-Apprunner', {
      serviceName: `${this.appName}_${this.stageName}_bo`,
      source: apprunner.Source.fromEcr({
        imageConfiguration: { port: 8080 },
        repository: ecr.Repository.fromRepositoryName(this, 'backoffice-repo', `${this.appName}_${this.stageName}_bo`),
        tagOrDigest: 'latest',
      }),
      vpcConnector,
      accessRole: this.lambdaRole
    });
  }
  private createVPC(props: GeneXusServerlessAngularAppProps){
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    this.vpc = new ec2.Vpc(this, `vpc`, {
      vpcName: `${apiName}-${stageName}-vpc`,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private_isolated',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ],
      maxAzs: 2
    });
  }

}
