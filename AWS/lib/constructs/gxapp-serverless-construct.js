"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneXusServerlessAngularApp = void 0;
const cdk = require("aws-cdk-lib");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const aws_events_targets_1 = require("aws-cdk-lib/aws-events-targets");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const lambda = require("aws-cdk-lib/aws-lambda");
const ecr = require("aws-cdk-lib/aws-ecr");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
const rds = require("aws-cdk-lib/aws-rds");
const apprunner = require("@aws-cdk/aws-apprunner-alpha");
const lambdaHandlerName = "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 8192;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";
class GeneXusServerlessAngularApp extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        this.isDevEnv = true;
        this.envVars = {};
        const stack = cdk.Stack.of(this);
        this.appName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        this.stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
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
        /*
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
        */
        // ----------------------------------------
        // Backoffice
        // ----------------------------------------
        this.createBackoofice();
        new cdk.CfnOutput(this, 'Backoffice - Apprunner-url', {
            value: `https://${this.appRunner.serviceUrl}`,
        });
        /*
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
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
          accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL
        });
        storageBucket.grantPutAcl(appGroup);
        storageBucket.grantReadWrite(appGroup);
        storageBucket.grantPublicAccess();
    
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
        */
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
    iamUserCreate(props) {
        const stack = cdk.Stack.of(this);
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        this.iamUser = new iam.User(this, `${apiName}-user`);
        // Generic Policies
        // S3 gx-deploy will be used to deploy the app to aws
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["s3:*"],
            resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
        }));
        // Grant access to all application lambda functions
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["lambda:*"],
            resources: [
                `arn:aws:lambda:${stack.region}:${stack.account}:function:${apiName}_*`,
            ],
        }));
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["apigateway:*"],
            resources: [`arn:aws:apigateway:${stack.region}::/restapis*`],
        }));
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [this.lambdaRole.roleArn],
        }));
        this.accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
            userName: this.iamUser.userName,
        });
    }
    lambdaRoleCreate(props) {
        this.lambdaRole = new iam.Role(this, `lambda-role`, {
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal("apigateway.amazonaws.com"), new iam.ServicePrincipal("lambda.amazonaws.com"), new iam.ServicePrincipal("build.apprunner.amazonaws.com")),
            description: "GeneXus Serverless Application Lambda Role",
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaSQSQueueExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSAppRunnerServicePolicyForECRAccess")
            ],
        });
    }
    createDynamo(props) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        // TODO: Ver si en algún momento Gx implementa el cambio de nombre en tablas en dataviews
        // Partitionkey "id" por compatibilidad con cosmos db
        this.DCache = new dynamodb.Table(this, `DCache`, {
            tableName: `DCache`,
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        this.DTicket = new dynamodb.Table(this, `DTicket`, {
            tableName: `DTicket`,
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        this.DTicket.addGlobalSecondaryIndex({
            indexName: 'TicketCodeIndex',
            partitionKey: { name: 'DTicketCode', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });
        this.DTicket.addGlobalSecondaryIndex({
            indexName: 'EmailIndex',
            partitionKey: { name: 'DEventId', type: dynamodb.AttributeType.NUMBER },
            sortKey: { name: 'DUserEmail', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });
    }
    createFestivalTicketsLambdas(props) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        this.queueLambdaFunction = new lambda.Function(this, `TicketProcess`, {
            functionName: `${apiName}_${stageName}_TicketProcess`,
            environment: this.envVars,
            runtime: defaultLambdaRuntime,
            handler: "com.genexus.cloud.serverless.aws.handler.LambdaSQSHandler::handleRequest",
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: this.lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || apiName}' Queue Ticket Process Lambda function`,
            logRetention: logs.RetentionDays.ONE_WEEK,
            securityGroups: [this.securityGroup]
        });
        // Lambda CRON
        this.cronLambdaFunction = new lambda.Function(this, `CronLambda`, {
            functionName: `${apiName}_${stageName}_Cron`,
            environment: this.envVars,
            runtime: defaultLambdaRuntime,
            handler: "com.genexus.cloud.serverless.aws.handler.LambdaEventBridgeHandler::handleRequest",
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: this.lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || apiName}' Cron Process Lambda function`,
            logRetention: logs.RetentionDays.ONE_WEEK,
            securityGroups: [this.securityGroup]
        });
        //EventBridge rule which runs every five minutes
        const cronRule = new aws_events_1.Rule(this, 'CronRule', {
            schedule: aws_events_1.Schedule.expression('cron(0/10 * * * ? *)')
        });
        cronRule.addTarget(new aws_events_targets_1.LambdaFunction(this.cronLambdaFunction));
    }
    createDB(props) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        const instanceIdentifier = `${apiName}-${stageName}-db`;
        this.dbServer = new rds.DatabaseInstance(this, `${apiName}-db`, {
            publiclyAccessible: this.isDevEnv,
            vpcSubnets: {
                onePerAz: true,
                subnetType: this.isDevEnv ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_NAT
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
        });
    }
    createBackoofice() {
        const vpcConnector = new apprunner.VpcConnector(this, 'VpcConnector', {
            vpc: this.vpc,
            vpcSubnets: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
            vpcConnectorName: `${this.appName}_${this.stageName}_VpcConnector`,
            securityGroups: [this.securityGroup]
        });
        // const repository = new ecr.Repository(this, "backoffice-repo", {
        //   repositoryName: `${this.appName}_${this.stageName}_bo`
        // });
        // ecr.Repository.fromRepositoryName(this, 'backoffice-repo', `${this.appName}_${this.stageName}_backoffice`),
        this.appRunner = new apprunner.Service(this, 'Frontend-Apprunner', {
            serviceName: `${this.appName}_${this.stageName}_frontend`,
            source: apprunner.Source.fromEcr({
                imageConfiguration: { port: 8080 },
                repository: ecr.Repository.fromRepositoryName(this, 'backoffice-repo', `${this.appName}_${this.stageName}_bo`),
                tagOrDigest: 'latest',
            }),
            vpcConnector,
            accessRole: this.lambdaRole
        });
    }
    createVPC(props) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
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
exports.GeneXusServerlessAngularApp = GeneXusServerlessAngularApp;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBbUM7QUFDbkMsdURBQXNEO0FBQ3RELHVFQUE4RDtBQUM5RCxxREFBcUQ7QUFFckQsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFHM0MsMkNBQTJDO0FBSTNDLDZDQUE2QztBQUU3QywyQ0FBdUM7QUFDdkMsZ0dBQWdHO0FBQ2hHLDJDQUEyQztBQUMzQywwREFBMEQ7QUFnQjFELE1BQU0saUJBQWlCLEdBQ3JCLCtEQUErRCxDQUFDO0FBQ2xFLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDO0FBQ3JDLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztBQUNwRCxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFDO0FBRXZELE1BQWEsMkJBQTRCLFNBQVEsc0JBQVM7SUFpQnhELFlBQ0UsS0FBZ0IsRUFDaEIsRUFBVSxFQUNWLEtBQXVDO1FBRXZDLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFuQm5CLGFBQVEsR0FBWSxJQUFJLENBQUM7UUFXekIsWUFBTyxHQUFRLEVBQUUsQ0FBQztRQVVoQixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxJQUFJLENBQUMsT0FBTyxHQUFHLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxFQUFFLENBQUM7UUFDcEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUss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QSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsU0FBUyxLQUFJLEVBQUUsQ0FBQztRQUV6QyxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ2xDLE9BQU8sRUFBRSxHQUFHLE9BQU8sSUFBSSxTQUFTLE1BQU07WUFDdEMsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxrQkFBa0I7b0JBQ3hCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7YUFDRjtZQUNELE1BQU0sRUFBRSxDQUFDO1NBQ1YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUVGO0FBL2xCRCxrRUErbEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcclxuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xyXG5pbXBvcnQge1J1bGUsIFNjaGVkdWxlfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50c1wiO1xyXG5pbXBvcnQge0xhbWJkYUZ1bmN0aW9ufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzXCI7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xyXG5pbXBvcnQgKiBhcyBlY3IgZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3JcIjtcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xyXG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xyXG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zXCI7XHJcbmltcG9ydCAqIGFzIGFjbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xyXG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInXHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG4vLyB7IENyZWRlbnRpYWxzLCBEYXRhYmFzZUluc3RhbmNlLCBEYXRhYmFzZUluc3RhbmNlRW5naW5lLCBEYXRhYmFzZVNlY3JldCwgTXlzcWxFbmdpbmVWZXJzaW9uIH1cclxuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xyXG5pbXBvcnQgKiBhcyBhcHBydW5uZXIgZnJvbSAnQGF3cy1jZGsvYXdzLWFwcHJ1bm5lci1hbHBoYSc7XHJcblxyXG5pbXBvcnQgeyBPcmlnaW5Qcm90b2NvbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xyXG5pbXBvcnQgeyB0aW1lU3RhbXAgfSBmcm9tIFwiY29uc29sZVwiO1xyXG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xyXG4gIHJlYWRvbmx5IGFwaU5hbWU6IHN0cmluZztcclxuICByZWFkb25seSBhcGlEZXNjcmlwdGlvbj86IHN0cmluZztcclxuICByZWFkb25seSB3ZWJEb21haW5OYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHN0YWdlTmFtZT86IHN0cmluZztcclxuICByZWFkb25seSB0aW1lb3V0PzogY2RrLkR1cmF0aW9uO1xyXG4gIHJlYWRvbmx5IG1lbW9yeVNpemU/OiBudW1iZXI7XHJcbiAgcmVhZG9ubHkgY2VydGlmaWNhdGVBUk4/OiBzdHJpbmcgfCBudWxsO1xyXG59XHJcblxyXG5jb25zdCBsYW1iZGFIYW5kbGVyTmFtZSA9XHJcbiAgXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5MYW1iZGFIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCI7XHJcbmNvbnN0IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplID0gODE5MjtcclxuY29uc3QgbGFtYmRhRGVmYXVsdFRpbWVvdXQgPSBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCk7XHJcbmNvbnN0IGRlZmF1bHRMYW1iZGFSdW50aW1lID0gbGFtYmRhLlJ1bnRpbWUuSkFWQV8xMTtcclxuY29uc3QgcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSA9IFwicmV3cml0ZS5oYW5kbGVyXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwIGV4dGVuZHMgQ29uc3RydWN0IHtcclxuICBhcHBOYW1lOiBzdHJpbmc7XHJcbiAgc3RhZ2VOYW1lOiBzdHJpbmc7XHJcbiAgaXNEZXZFbnY6IGJvb2xlYW4gPSB0cnVlO1xyXG4gIHZwYzogZWMyLlZwYztcclxuICBkYlNlcnZlcjogcmRzLkRhdGFiYXNlSW5zdGFuY2U7XHJcbiAgaWFtVXNlcjogaWFtLlVzZXI7XHJcbiAgRFRpY2tldDogZHluYW1vZGIuVGFibGU7XHJcbiAgRENhY2hlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBxdWV1ZUxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgY3JvbkxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgbGFtYmRhUm9sZTogaWFtLlJvbGU7XHJcbiAgc2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XHJcbiAgYWNjZXNzS2V5OiBpYW0uQ2ZuQWNjZXNzS2V5O1xyXG4gIGVudlZhcnM6IGFueSA9IHt9O1xyXG4gIGFwcFJ1bm5lcjogYXBwcnVubmVyLlNlcnZpY2U7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgICBwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHNcclxuICApIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCk7XHJcblxyXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XHJcblxyXG4gICAgdGhpcy5hcHBOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIHRoaXMuc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIGlmICh0aGlzLmFwcE5hbWUubGVuZ3RoID09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQVBJIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLnN0YWdlTmFtZS5sZW5ndGggPT0gMCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTdGFnZSBOYW1lIGNhbm5vdCBiZSBlbXB0eVwiKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBXYXJtVXBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBwTmFtZVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwcE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFwcGxpY2F0aW9uIE5hbWVcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdGFnZU5hbWVcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5zdGFnZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlN0YWdlIE5hbWVcIixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIExhbWJkYSBSb2xlXHJcbiAgICB0aGlzLmxhbWJkYVJvbGVDcmVhdGUocHJvcHMpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIElBTSBVc2VyIGFuZCBncm91cHNcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIHRoaXMuaWFtVXNlckNyZWF0ZShwcm9wcyk7XHJcbiAgICBjb25zdCBhcHBHcm91cCA9IG5ldyBpYW0uR3JvdXAodGhpcywgJ2FwcC1ncm91cC1pZCcsIHtcclxuICAgICAgZ3JvdXBOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2FwcGdyb3VwYFxyXG4gICAgfSk7XHJcbiAgICBhcHBHcm91cC5hZGRVc2VyKHRoaXMuaWFtVXNlcik7IFxyXG4gICAgXHJcbiAgICAvLyBOb3RlOiBNYXhpbXVtIHBvbGljeSBzaXplIG9mIDIwNDggYnl0ZXMgZXhjZWVkZWQgZm9yIHVzZXJcclxuICAgIGNvbnN0IGZlc3RHcm91cCA9IG5ldyBpYW0uR3JvdXAodGhpcywgJ2Zlc3RpdmFsLWdyb3VwLWlkJywge1xyXG4gICAgICBncm91cE5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fZmVzdGdyb3VwYFxyXG4gICAgfSk7XHJcbiAgICBmZXN0R3JvdXAuYWRkVXNlcih0aGlzLmlhbVVzZXIpO1xyXG5cclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gVlBDXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIHRoaXMuY3JlYXRlVlBDKHByb3BzKTsgXHJcbiAgICBjb25zdCBEeW5hbW9HYXRld2F5RW5kcG9pbnQgPSB0aGlzLnZwYy5hZGRHYXRld2F5RW5kcG9pbnQoJ0R5bmFtby1lbmRwb2ludCcsIHtcclxuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuRFlOQU1PREJcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3VyaXR5IGdyb3VwXHJcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgYHJkcy1zZ2AsIHtcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBSRFMgLSBNeVNRTCA4LjBcclxuICAgIC8qXHJcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKCB0aGlzLnNlY3VyaXR5R3JvdXAsIGVjMi5Qb3J0LnRjcCgzMzA2KSk7XHJcbiAgICBpZiAodGhpcy5pc0RldkVudikge1xyXG4gICAgICAvL0FjY2VzcyBmcm9tIE15SVBcclxuICAgICAgdGhpcy5zZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbSggZWMyLlBlZXIuaXB2NCgnMTAwLjEwMC4xMDAuMTAwLzMyJyksIGVjMi5Qb3J0LnRjcFJhbmdlKDEsIDY1NTM1KSk7IFxyXG4gICAgfVxyXG4gICAgdGhpcy5jcmVhdGVEQihwcm9wcyk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEQkVuZFBvaW50XCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuZGJJbnN0YW5jZUVuZHBvaW50QWRkcmVzcyxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIEVuZHBvaW50XCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RCU2VjcmV0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXROYW1lISxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIFNlY3JldCBOYW1lXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIER5bmFtb1xyXG4gICAgdGhpcy5jcmVhdGVEeW5hbW8ocHJvcHMpO1xyXG4gICAgdGhpcy5EQ2FjaGUuZ3JhbnRSZWFkV3JpdGVEYXRhKCBmZXN0R3JvdXApO1xyXG4gICAgdGhpcy5EVGlja2V0LmdyYW50UmVhZFdyaXRlRGF0YSggZmVzdEdyb3VwKTtcclxuXHJcbiAgICAvLyBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vRENhY2hlVGFibGVOYW1lJywgeyB2YWx1ZTogdGhpcy5EQ2FjaGUudGFibGVOYW1lIH0pO1xyXG4gICAgLy8gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0R5bmFtb0RUaWNrZXRUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRUaWNrZXQudGFibGVOYW1lIH0pO1xyXG4gICAgXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBTUVMgVGlja2V0IFF1ZXVlXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBjb25zdCB0aWNrZXRRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgYHRpY2tldHF1ZXVlYCwge1xyXG4gICAgICBxdWV1ZU5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fdGlja2V0cXVldWVgXHJcbiAgICB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU1FTVGlja2V0VXJsXCIsIHtcclxuICAgICAgdmFsdWU6IHRpY2tldFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJTUVMgVGlja2V0IFVybFwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICB0aGlzLmVudlZhcnNbYFJFR0lPTmBdID0gY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRkVTVElWQUxUSUNLRVRTX1FVRVVFVVJMYF0gPSB0aWNrZXRRdWV1ZS5xdWV1ZVVybDtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfREVGQVVMVF9EQl9VUkxgXSA9IGBqZGJjOm15c3FsOi8vJHt0aGlzLmRiU2VydmVyLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3N9L2Zlc3RpdmFsdGlja2V0cz91c2VTU0w9ZmFsc2VgO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfSURgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCd1c2VybmFtZScpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfUEFTU1dPUkRgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCdwYXNzd29yZCcpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9EWU5BTU9EQkRTX1VTRVJfSURgXSA9IHRoaXMuYWNjZXNzS2V5LnJlZjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRFlOQU1PREJEU19VU0VSX1BBU1NXT1JEYF0gPSB0aGlzLmFjY2Vzc0tleS5hdHRyU2VjcmV0QWNjZXNzS2V5O1xyXG4gICAgKi9cclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQmFja29mZmljZVxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgdGhpcy5jcmVhdGVCYWNrb29maWNlKCk7XHJcbiAgICBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCYWNrb2ZmaWNlIC0gQXBwcnVubmVyLXVybCcsIHtcclxuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5hcHBSdW5uZXIuc2VydmljZVVybH1gLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLypcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEZlc3RpdmFsVGlja2V0cyBMYW1iZGFzIChTUVMgJiBDUk9OKVxyXG4gICAgdGhpcy5jcmVhdGVGZXN0aXZhbFRpY2tldHNMYW1iZGFzKCBwcm9wcyk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJMYW1iZGFUaWNrZXRQcm9jZXNzXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMucXVldWVMYW1iZGFGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlRpY2tldCBQcm9jZXNzIExhbWJkYSBOYW1lXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYUNyb25cIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5jcm9uTGFtYmRhRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJUaWNrZXQgUnVmZmxlIExhbWJkYSBDcm9uXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTb21lIHF1ZXVlIHBlcm1pc3Npb25zXHJcbiAgICB0aWNrZXRRdWV1ZS5ncmFudENvbnN1bWVNZXNzYWdlcyh0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24pO1xyXG4gICAgdGlja2V0UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoZmVzdEdyb3VwKTtcclxuICAgIFxyXG4gICAgLy8gTGFtYmRhIHF1ZXVlIHRyaWdnZXJcclxuICAgIGNvbnN0IGV2ZW50U291cmNlID0gbmV3IGxhbWJkYUV2ZW50U291cmNlcy5TcXNFdmVudFNvdXJjZSh0aWNrZXRRdWV1ZSk7XHJcbiAgICB0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UoZXZlbnRTb3VyY2UpO1xyXG4gICAgXHJcbiAgICBcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBTdG9yYWdlXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgY29uc3Qgc3RvcmFnZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1idWNrZXRgLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BQ0xTLFxyXG4gICAgICBhY2Nlc3NDb250cm9sOiBzMy5CdWNrZXRBY2Nlc3NDb250cm9sLkJVQ0tFVF9PV05FUl9GVUxMX0NPTlRST0xcclxuICAgIH0pO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFB1dEFjbChhcHBHcm91cCk7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwcEdyb3VwKTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRQdWJsaWNBY2Nlc3MoKTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN0b3JhZ2UtQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RvcmFnZSAtIEJ1Y2tldCBmb3IgU3RvcmFnZSBTZXJ2aWNlXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQmFja2VuZCBzZXJ2aWNlc1xyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1hcGlnd2AsIHtcclxuICAgICAgZGVzY3JpcHRpb246IGAke3RoaXMuYXBwTmFtZX0gQVBJR2F0ZXdheSBFbmRwb2ludGAsXHJcbiAgICAgIHJlc3RBcGlOYW1lOiB0aGlzLmFwcE5hbWUsXHJcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcclxuICAgICAgICBzdGFnZU5hbWU6IHRoaXMuc3RhZ2VOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIlgtQW16LURhdGVcIixcclxuICAgICAgICAgIFwiQXV0aG9yaXphdGlvblwiLFxyXG4gICAgICAgICAgXCJYLUFwaS1LZXlcIixcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogW1wiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiXSxcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxyXG4gICAgICAgIGFsbG93T3JpZ2luczogW1wiKlwiXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uTmFtZSA9IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1gO1xyXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tZnVuY3Rpb25gLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogbGFtYmRhRnVuY3Rpb25OYW1lLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogbGFtYmRhSGFuZGxlck5hbWUsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IHRoaXMuYXBwTmFtZVxyXG4gICAgICB9JyBTZXJ2ZXJsZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXSxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRENhY2hlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZ1bmN0aW9uKTtcclxuICAgIGxhbWJkYUZ1bmN0aW9uLmdyYW50SW52b2tlKGFwcEdyb3VwKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQW5ndWxhciBBcHAgSG9zdFxyXG4gICAgLy8gTWF4aW11bSBwb2xpY3kgc2l6ZSBvZiAyMDQ4IGJ5dGVzIGV4Y2VlZGVkIGZvciB1c2VyXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBcclxuICAgIGNvbnN0IHdlYnNpdGVQdWJsaWNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tYnVja2V0LXdlYmAsIHtcclxuICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6IFwiaW5kZXguaHRtbFwiLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUNMUyxcclxuICAgICAgYWNjZXNzQ29udHJvbDogczMuQnVja2V0QWNjZXNzQ29udHJvbC5CVUNLRVRfT1dORVJfRlVMTF9DT05UUk9MXHJcbiAgICB9KTtcclxuXHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwcEdyb3VwKTtcclxuXHJcbiAgICBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlXCJdLFxyXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlID1cclxuICAgICAgbmV3IGNsb3VkZnJvbnQuZXhwZXJpbWVudGFsLkVkZ2VGdW5jdGlvbih0aGlzLCBgJHt0aGlzLmFwcE5hbWV9RWRnZUxhbWJkYWAsIHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6IGAke3RoaXMuYXBwTmFtZX0tJHt0aGlzLnN0YWdlTmFtZX0tRWRnZUxhbWJkYWAsXHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXHJcbiAgICAgICAgaGFuZGxlcjogcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSxcclxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoXCJsYW1iZGFcIiksXHJcbiAgICAgICAgZGVzY3JpcHRpb246IGBHZW5lWHVzIEFuZ3VsYXIgUmV3cml0ZSBMYW1iZGEgZm9yIENsb3VkZnJvbnRgLFxyXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyAgICAgICAgXHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5ncmFudEludm9rZShhcHBHcm91cCk7XHJcbiAgICByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UuYWRkQWxpYXMoXCJsaXZlXCIsIHt9KTtcclxuXHJcbiAgICBjb25zdCBvcmlnaW5Qb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5KFxyXG4gICAgICB0aGlzLFxyXG4gICAgICBgJHt0aGlzLmFwcE5hbWV9SHR0cE9yaWdpblBvbGljeWAsXHJcbiAgICAgIHtcclxuICAgICAgICAvL29yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBcIkdYLUhUVFAtT3JpZ2luLVBvbGljeVwiLFxyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gT3JpZ2luIEh0dHAgUG9saWN5YCxcclxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLmFsbG93TGlzdChcclxuICAgICAgICAgIFwiQWNjZXB0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1DaGFyc2V0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1MYW5ndWFnZVwiLFxyXG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcclxuICAgICAgICAgIFwiR3hUWk9mZnNldFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VJZFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VUeXBlXCIsXHJcbiAgICAgICAgICBcIlJlZmVyZXJcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5hbGwoKSxcclxuICAgICAgfVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBwcm9wcz8uY2VydGlmaWNhdGVBUk5cclxuICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKFxyXG4gICAgICAgICAgdGhpcyxcclxuICAgICAgICAgIFwiQ2xvdWRmcm9udCBDZXJ0aWZpY2F0ZVwiLFxyXG4gICAgICAgICAgcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgICAgKVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCB3ZWJEaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke3RoaXMuYXBwTmFtZX0tY2RuYCxcclxuICAgICAge1xyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gQ2xvdWRmcm9udCBEaXN0cmlidXRpb25gLFxyXG4gICAgICAgIGRvbWFpbk5hbWVzOiBwcm9wcz8ud2ViRG9tYWluTmFtZSA/IFtwcm9wcz8ud2ViRG9tYWluTmFtZV0gOiB1bmRlZmluZWQsXHJcbiAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxyXG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xyXG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih3ZWJzaXRlUHVibGljQnVja2V0KSxcclxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxyXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkNPUlNfUzNfT1JJR0lOLFxyXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XHJcbiAgICAgICAgICAgIGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXHJcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXHJcbiAgICAgICAgICBlZGdlTGFtYmRhczogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgZnVuY3Rpb25WZXJzaW9uOiByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UsXHJcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkxhbWJkYUVkZ2VFdmVudFR5cGUuT1JJR0lOX1JFU1BPTlNFLFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgYXBpRG9tYWluTmFtZSA9IGAke2FwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7c3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcclxuXHJcbiAgICBjb25zdCBhcGlHYXRld2F5T3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlEb21haW5OYW1lLCB7XHJcbiAgICAgIHByb3RvY29sUG9saWN5OiBPcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgd2ViRGlzdHJpYnV0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShhcGkpO1xyXG5cclxuICAgIHdlYkRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcihgLyR7dGhpcy5zdGFnZU5hbWV9LypgLCBhcGlHYXRld2F5T3JpZ2luLCB7XHJcbiAgICAgIGNvbXByZXNzOiB0cnVlLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5BTExPV19BTEwsXHJcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogb3JpZ2luUG9saWN5LFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIC8vIEJhY2tlbmQgLSBBcGkgZ2F0ZXdheVxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcGlVUkxcIiwge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt3ZWJEaXN0cmlidXRpb24uZG9tYWluTmFtZX0vJHt0aGlzLnN0YWdlTmFtZX0vYCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQmFja2VuZCAtIFNlcnZpY2VzIEFQSSBVUkwgKFNlcnZpY2VzIFVSTClcIixcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICAvLyBGcm9udGVuZCAtIEFuZ3VsYXJcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRnJvbnRlbmQtQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHdlYnNpdGVQdWJsaWNCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiRnJvbnRlbmQgLSBCdWNrZXQgTmFtZSBmb3IgQW5ndWxhciBXZWJTaXRlIERlcGxveW1lbnRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRnJvbnRlbmQtV2ViVVJMXCIsIHtcclxuICAgICAgdmFsdWU6IGBodHRwczovLyR7d2ViRGlzdHJpYnV0aW9uLmRvbWFpbk5hbWV9YCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiRnJvbnRlbmQgLSBXZWJzaXRlIFVSTFwiLFxyXG4gICAgfSk7XHJcbiAgICAqL1xyXG4gICAgXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYSAtIElBTVJvbGVBUk5cIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5sYW1iZGFSb2xlLnJvbGVBcm4sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIklBTSBSb2xlIEFSTlwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hY2Nlc3NLZXkucmVmLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJBY2Nlc3MgS2V5XCIsXHJcbiAgICB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQWNjZXNzU2VjcmV0S2V5XCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYWNjZXNzS2V5LmF0dHJTZWNyZXRBY2Nlc3NLZXksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBTZWNyZXQgS2V5XCIsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaWFtVXNlckNyZWF0ZShwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIgPSBuZXcgaWFtLlVzZXIodGhpcywgYCR7YXBpTmFtZX0tdXNlcmApO1xyXG5cclxuICAgIC8vIEdlbmVyaWMgUG9saWNpZXNcclxuICAgIC8vIFMzIGd4LWRlcGxveSB3aWxsIGJlIHVzZWQgdG8gZGVwbG95IHRoZSBhcHAgdG8gYXdzXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJzMzoqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW1wiYXJuOmF3czpzMzo6Omd4LWRlcGxveS8qXCIsIFwiYXJuOmF3czpzMzo6Omd4LWRlcGxveSpcIl0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG4gICAgLy8gR3JhbnQgYWNjZXNzIHRvIGFsbCBhcHBsaWNhdGlvbiBsYW1iZGEgZnVuY3Rpb25zXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJsYW1iZGE6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgIGBhcm46YXdzOmxhbWJkYToke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpmdW5jdGlvbjoke2FwaU5hbWV9XypgLFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMuaWFtVXNlci5hZGRUb1BvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGFjdGlvbnM6IFtcImFwaWdhdGV3YXk6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzKmBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJpYW06UGFzc1JvbGVcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sYW1iZGFSb2xlLnJvbGVBcm5dLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmFjY2Vzc0tleSA9IG5ldyBpYW0uQ2ZuQWNjZXNzS2V5KHRoaXMsIGAke2FwaU5hbWV9LWFjY2Vzc2tleWAsIHtcclxuICAgICAgdXNlck5hbWU6IHRoaXMuaWFtVXNlci51c2VyTmFtZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBsYW1iZGFSb2xlQ3JlYXRlKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICB0aGlzLmxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgYGxhbWJkYS1yb2xlYCwge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxyXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJidWlsZC5hcHBydW5uZXIuYW1hem9uYXdzLmNvbVwiKVxyXG4gICAgICApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJHZW5lWHVzIFNlcnZlcmxlc3MgQXBwbGljYXRpb24gTGFtYmRhIFJvbGVcIixcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFTUVNRdWV1ZUV4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTQXBwUnVubmVyU2VydmljZVBvbGljeUZvckVDUkFjY2Vzc1wiXHJcbiAgICAgICAgKVxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW8ocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IGFwaU5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIC8vIFRPRE86IFZlciBzaSBlbiBhbGfDum4gbW9tZW50byBHeCBpbXBsZW1lbnRhIGVsIGNhbWJpbyBkZSBub21icmUgZW4gdGFibGFzIGVuIGRhdGF2aWV3c1xyXG4gICAgLy8gUGFydGl0aW9ua2V5IFwiaWRcIiBwb3IgY29tcGF0aWJpbGlkYWQgY29uIGNvc21vcyBkYlxyXG4gICAgdGhpcy5EQ2FjaGUgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEQ2FjaGVgLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYERDYWNoZWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLkRUaWNrZXQgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEVGlja2V0YCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEVGlja2V0YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuRFRpY2tldC5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1RpY2tldENvZGVJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge25hbWU6ICdEVGlja2V0Q29kZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HfSxcclxuICAgICAgcmVhZENhcGFjaXR5OiAxLFxyXG4gICAgICB3cml0ZUNhcGFjaXR5OiAxLFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5EVGlja2V0LmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRW1haWxJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge25hbWU6ICdERXZlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSfSxcclxuICAgICAgc29ydEtleToge25hbWU6ICdEVXNlckVtYWlsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkd9LFxyXG4gICAgICByZWFkQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHdyaXRlQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuICB9XHJcbiAgcHJpdmF0ZSBjcmVhdGVGZXN0aXZhbFRpY2tldHNMYW1iZGFzKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICB0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGBUaWNrZXRQcm9jZXNzYCwge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwaU5hbWV9XyR7c3RhZ2VOYW1lfV9UaWNrZXRQcm9jZXNzYCxcclxuICAgICAgZW52aXJvbm1lbnQ6IHRoaXMuZW52VmFycyxcclxuICAgICAgcnVudGltZTogZGVmYXVsdExhbWJkYVJ1bnRpbWUsXHJcbiAgICAgIGhhbmRsZXI6IFwiY29tLmdlbmV4dXMuY2xvdWQuc2VydmVybGVzcy5hd3MuaGFuZGxlci5MYW1iZGFTUVNIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCIsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgUXVldWUgVGlja2V0IFByb2Nlc3MgTGFtYmRhIGZ1bmN0aW9uYCxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIENST05cclxuICAgIHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBgQ3JvbkxhbWJkYWAsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fQ3JvbmAsXHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIHJ1bnRpbWU6IGRlZmF1bHRMYW1iZGFSdW50aW1lLFxyXG4gICAgICBoYW5kbGVyOiBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLmhhbmRsZXIuTGFtYmRhRXZlbnRCcmlkZ2VIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCIsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgQ3JvbiBQcm9jZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG4gICAgLy9FdmVudEJyaWRnZSBydWxlIHdoaWNoIHJ1bnMgZXZlcnkgZml2ZSBtaW51dGVzXHJcbiAgICBjb25zdCBjcm9uUnVsZSA9IG5ldyBSdWxlKHRoaXMsICdDcm9uUnVsZScsIHtcclxuICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmV4cHJlc3Npb24oJ2Nyb24oMC8xMCAqICogKiA/ICopJylcclxuICAgIH0pXHJcbiAgICBjcm9uUnVsZS5hZGRUYXJnZXQobmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZURCKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICBjb25zdCBpbnN0YW5jZUlkZW50aWZpZXIgPSBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tZGJgO1xyXG5cclxuICAgIHRoaXMuZGJTZXJ2ZXIgPSBuZXcgcmRzLkRhdGFiYXNlSW5zdGFuY2UodGhpcywgYCR7YXBpTmFtZX0tZGJgLCB7XHJcbiAgICAgIHB1YmxpY2x5QWNjZXNzaWJsZTogdGhpcy5pc0RldkVudixcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIG9uZVBlckF6OiB0cnVlLFxyXG4gICAgICAgIHN1Ym5ldFR5cGU6IHRoaXMuaXNEZXZFbnYgPyBlYzIuU3VibmV0VHlwZS5QVUJMSUMgOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfTkFUXHJcbiAgICAgIH0sXHJcbiAgICAgIGNyZWRlbnRpYWxzOiByZHMuQ3JlZGVudGlhbHMuZnJvbUdlbmVyYXRlZFNlY3JldCgnZGJhZG1pbicpLFxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBwb3J0OiAzMzA2LFxyXG4gICAgICBkYXRhYmFzZU5hbWU6ICdmZXN0aXZhbHRpY2tldHMnLFxyXG4gICAgICBhbGxvY2F0ZWRTdG9yYWdlOiAyMCxcclxuICAgICAgaW5zdGFuY2VJZGVudGlmaWVyLFxyXG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUluc3RhbmNlRW5naW5lLm15c3FsKHtcclxuICAgICAgICB2ZXJzaW9uOiByZHMuTXlzcWxFbmdpbmVWZXJzaW9uLlZFUl84XzBcclxuICAgICAgfSksXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXSxcclxuICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlQ0RywgZWMyLkluc3RhbmNlU2l6ZS5NSUNSTyksXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IHRoaXMuaXNEZXZFbnYgPyBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIDogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOXHJcbiAgICB9KVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVCYWNrb29maWNlKCl7ICAgIFxyXG4gICAgY29uc3QgdnBjQ29ubmVjdG9yID0gbmV3IGFwcHJ1bm5lci5WcGNDb25uZWN0b3IodGhpcywgJ1ZwY0Nvbm5lY3RvcicsIHtcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgdnBjU3VibmV0czogdGhpcy52cGMuc2VsZWN0U3VibmV0cyh7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSksXHJcbiAgICAgIHZwY0Nvbm5lY3Rvck5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fVnBjQ29ubmVjdG9yYCxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt0aGlzLnNlY3VyaXR5R3JvdXBdXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBjb25zdCByZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsIFwiYmFja29mZmljZS1yZXBvXCIsIHtcclxuICAgIC8vICAgcmVwb3NpdG9yeU5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fYm9gXHJcbiAgICAvLyB9KTtcclxuXHJcbiAgICAvLyBlY3IuUmVwb3NpdG9yeS5mcm9tUmVwb3NpdG9yeU5hbWUodGhpcywgJ2JhY2tvZmZpY2UtcmVwbycsIGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fYmFja29mZmljZWApLFxyXG5cclxuICAgIHRoaXMuYXBwUnVubmVyID0gbmV3IGFwcHJ1bm5lci5TZXJ2aWNlKHRoaXMsICdGcm9udGVuZC1BcHBydW5uZXInLCB7XHJcbiAgICAgIHNlcnZpY2VOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2Zyb250ZW5kYCxcclxuICAgICAgc291cmNlOiBhcHBydW5uZXIuU291cmNlLmZyb21FY3Ioe1xyXG4gICAgICAgIGltYWdlQ29uZmlndXJhdGlvbjogeyBwb3J0OiA4MDgwIH0sXHJcbiAgICAgICAgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKHRoaXMsICdiYWNrb2ZmaWNlLXJlcG8nLCBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2JvYCksXHJcbiAgICAgICAgdGFnT3JEaWdlc3Q6ICdsYXRlc3QnLFxyXG4gICAgICB9KSxcclxuICAgICAgdnBjQ29ubmVjdG9yLFxyXG4gICAgICBhY2Nlc3NSb2xlOiB0aGlzLmxhbWJkYVJvbGVcclxuICAgIH0pO1xyXG4gIH1cclxuICBwcml2YXRlIGNyZWF0ZVZQQyhwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy52cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCBgdnBjYCwge1xyXG4gICAgICB2cGNOYW1lOiBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tdnBjYCxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGVfaXNvbGF0ZWQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU1xyXG4gICAgICAgIH1cclxuICAgICAgXSxcclxuICAgICAgbWF4QXpzOiAyXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG59XHJcbiJdfQ==