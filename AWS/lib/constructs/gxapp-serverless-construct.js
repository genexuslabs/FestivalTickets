"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneXusServerlessAngularApp = void 0;
const apigateway = require("aws-cdk-lib/aws-apigateway");
const cdk = require("aws-cdk-lib");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const aws_events_targets_1 = require("aws-cdk-lib/aws-events-targets");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const sqs = require("aws-cdk-lib/aws-sqs");
const lambda = require("aws-cdk-lib/aws-lambda");
const ecr = require("aws-cdk-lib/aws-ecr");
const ec2 = require("aws-cdk-lib/aws-ec2");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const logs = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
const rds = require("aws-cdk-lib/aws-rds");
const apprunner = require("@aws-cdk/aws-apprunner-alpha");
const aws_cloudfront_1 = require("aws-cdk-lib/aws-cloudfront");
const lambdaHandlerName = "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 8192;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";
class GeneXusServerlessAngularApp extends constructs_1.Construct {
    constructor(scope, id, props) {
        var _a, _b, _c;
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
        // -------------------------------
        // Lambda Role
        this.lambdaRoleCreate(props);
        // -------------------------------
        // IAM User
        this.iamUserCreate(props);
        //----------------------------------
        // VPC
        this.createVPC(props);
        const DynamoGatewayEndpoint = this.vpc.addGatewayEndpoint('Dynamo-endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB
        });
        //---------------------------------
        // RDS - MySQL 8.0
        this.securityGroup = new ec2.SecurityGroup(this, `rds-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true
        });
        this.securityGroup.connections.allowFrom(this.securityGroup, ec2.Port.tcp(3306));
        if (this.isDevEnv) {
            //Access from MyIP
            this.securityGroup.connections.allowFrom(ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535));
        }
        this.createDB(props);
        // ---------------------------------
        // Dynamo
        this.createDynamo(props);
        // --------------------------------------
        // User groups to split policies
        // Note: Maximum policy size of 2048 bytes exceeded for user
        const festGroup = new iam.Group(this, 'festival-group-id', {
            groupName: `${this.appName}_${this.stageName}_festgroup`
        });
        festGroup.addUser(this.iamUser);
        this.DCache.grantReadWriteData(festGroup);
        this.DTicket.grantReadWriteData(festGroup);
        // -------------------------------
        // SQS Ticket Queue
        const ticketQueue = new sqs.Queue(this, `ticketqueue`, {
            queueName: `${this.appName}_${this.stageName}_ticketqueue`
        });
        // -------------------------------
        // Environment variables
        this.envVars[`REGION`] = cdk.Stack.of(this).region;
        this.envVars[`GX_FESTIVALTICKETS_QUEUEURL`] = ticketQueue.queueUrl;
        this.envVars[`GX_DEFAULT_DB_URL`] = `jdbc:mysql://${this.dbServer.dbInstanceEndpointAddress}/festivaltickets?useSSL=false`;
        this.envVars[`GX_DEFAULT_USER_ID`] = (_a = this.dbServer.secret) === null || _a === void 0 ? void 0 : _a.secretValueFromJson('username');
        this.envVars[`GX_DEFAULT_USER_PASSWORD`] = (_b = this.dbServer.secret) === null || _b === void 0 ? void 0 : _b.secretValueFromJson('password');
        this.envVars[`GX_DYNAMODBDS_USER_ID`] = this.accessKey.ref;
        this.envVars[`GX_DYNAMODBDS_USER_PASSWORD`] = this.accessKey.attrSecretAccessKey;
        // -------------------------------
        // FestivalTickets Lambdas (SQS & CRON)
        this.createFestivalTicketsLambdas(props);
        // Some queue permissions
        ticketQueue.grantConsumeMessages(this.queueLambdaFunction);
        ticketQueue.grantSendMessages(festGroup);
        // Lambda queue trigger
        const eventSource = new lambdaEventSources.SqsEventSource(ticketQueue);
        this.queueLambdaFunction.addEventSource(eventSource);
        // -------------------------------------------------------------
        // Angular App Host
        // Maximum policy size of 2048 bytes exceeded for user
        const appGroup = new iam.Group(this, 'app-group-id', {
            groupName: `${this.appName}_${this.stageName}_appgroup`
        });
        appGroup.addUser(this.iamUser);
        const websitePublicBucket = new s3.Bucket(this, `${this.appName}-bucket-web`, {
            websiteIndexDocument: "index.html",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
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
        // Storage
        const storageBucket = new s3.Bucket(this, `${this.appName}-bucket`, {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        storageBucket.grantPutAcl(appGroup);
        storageBucket.grantReadWrite(appGroup);
        storageBucket.grantPublicAccess();
        // -----------------------------
        // Backend services
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
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: this.lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || this.appName}' Serverless Lambda function`,
            securityGroups: [this.securityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        this.DCache.grantReadWriteData(lambdaFunction);
        this.DTicket.grantReadWriteData(lambdaFunction);
        lambdaFunction.grantInvoke(appGroup);
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["apigateway:*"],
            resources: [
                `arn:aws:apigateway:${stack.region}::/restapis/${api.restApiId}*`,
            ],
        }));
        const rewriteEdgeFunctionResponse = new cloudfront.experimental.EdgeFunction(this, `${this.appName}EdgeLambda`, {
            functionName: `${this.appName}-${this.stageName}-EdgeLambda`,
            runtime: lambda.Runtime.NODEJS_14_X,
            handler: rewriteEdgeLambdaHandlerName,
            code: lambda.Code.fromAsset("lambda"),
            description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
            logRetention: logs.RetentionDays.FIVE_DAYS
        });
        rewriteEdgeFunctionResponse.grantInvoke(appGroup);
        rewriteEdgeFunctionResponse.addAlias("live", {});
        const originPolicy = new cloudfront.OriginRequestPolicy(this, `${this.appName}HttpOriginPolicy`, {
            //originRequestPolicyName: "GX-HTTP-Origin-Policy",
            comment: `${this.appName} Origin Http Policy`,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept", "Accept-Charset", "Accept-Language", "Content-Type", "GxTZOffset", "DeviceId", "DeviceType", "Referer"),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.all(),
        });
        const certificate = (props === null || props === void 0 ? void 0 : props.certificateARN)
            ? acm.Certificate.fromCertificateArn(this, "Cloudfront Certificate", props === null || props === void 0 ? void 0 : props.certificateARN)
            : undefined;
        const webDistribution = new cloudfront.Distribution(this, `${this.appName}-cdn`, {
            comment: `${this.appName} Cloudfront Distribution`,
            domainNames: (props === null || props === void 0 ? void 0 : props.webDomainName) ? [props === null || props === void 0 ? void 0 : props.webDomainName] : undefined,
            certificate: certificate,
            defaultBehavior: {
                origin: new origins.S3Origin(websitePublicBucket),
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                edgeLambdas: [
                    {
                        functionVersion: rewriteEdgeFunctionResponse,
                        eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
                    }
                ],
            },
        });
        const apiDomainName = `${api.restApiId}.execute-api.${stack.region}.amazonaws.com`;
        const apiGatewayOrigin = new origins.HttpOrigin(apiDomainName, {
            protocolPolicy: aws_cloudfront_1.OriginProtocolPolicy.HTTPS_ONLY,
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
        // Generic
        // ****************************************
        new cdk.CfnOutput(this, "AppName", {
            value: this.appName,
            description: "Application Name",
        });
        new cdk.CfnOutput(this, "StageName", {
            value: this.stageName,
            description: "Stage Name",
        });
        // ****************************************
        // Backoffice
        // ****************************************
        new cdk.CfnOutput(this, 'Backoffice - Apprunner-url', {
            value: 'https://' + this.appRunner.serviceUrl,
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
        new cdk.CfnOutput(this, "Storage-Bucket", {
            value: storageBucket.bucketName,
            description: "Storage - Bucket for Storage Service",
        });
        // ****************************************
        // DB - RDS MySQL
        // ****************************************
        new cdk.CfnOutput(this, "DBEndPoint", {
            value: this.dbServer.dbInstanceEndpointAddress,
            description: "RDS MySQL Endpoint",
        });
        new cdk.CfnOutput(this, 'DBSecretName', {
            value: (_c = this.dbServer.secret) === null || _c === void 0 ? void 0 : _c.secretName,
            description: "RDS MySQL Secret Name",
        });
        // Get access to the secret object
        // const dbPasswordSecret = secretsmanager.Secret.fromSecretNameV2(
        //   this,
        //   'db-pwd-id',
        //   this.dbServer.secret?.secretName!,
        // );
        // Dynamo
        // new cdk.CfnOutput(this, 'DynamoDCacheTableName', { value: this.DCache.tableName });
        // new cdk.CfnOutput(this, 'DynamoDTicketTableName', { value: this.DTicket.tableName });
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
        new cdk.CfnOutput(this, "SQSTicketUrl", {
            value: ticketQueue.queueUrl,
            description: "SQS Ticket Url",
        });
        new cdk.CfnOutput(this, "LambdaTicketProcess", {
            value: this.queueLambdaFunction.functionName,
            description: "Ticket Process Lambda Name",
        });
        new cdk.CfnOutput(this, "LambdaCron", {
            value: this.cronLambdaFunction.functionName,
            description: "Ticket Ruffle Lambda Cron",
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
        this.appRunner = new apprunner.Service(this, 'Frontend-Apprunner', {
            serviceName: `${this.appName}_${this.stageName}_frontend`,
            source: apprunner.Source.fromEcr({
                imageConfiguration: { port: 8080 },
                repository: ecr.Repository.fromRepositoryName(this, 'backoffice-repo', `${this.appName}_${this.stageName}_backoffice`),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5REFBeUQ7QUFDekQsbUNBQW1DO0FBQ25DLHVEQUFzRDtBQUN0RCx1RUFBOEQ7QUFDOUQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyRUFBMkU7QUFDM0UseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQyx5REFBeUQ7QUFDekQsOERBQThEO0FBQzlELDBEQUEwRDtBQUMxRCw2Q0FBNkM7QUFFN0MsMkNBQXVDO0FBQ3ZDLGdHQUFnRztBQUNoRywyQ0FBMkM7QUFDM0MsMERBQTBEO0FBRTFELCtEQUFrRTtBQWNsRSxNQUFNLGlCQUFpQixHQUNyQiwrREFBK0QsQ0FBQztBQUNsRSxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQztBQUNyQyxNQUFNLG9CQUFvQixHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3RELE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDcEQsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQztBQUV2RCxNQUFhLDJCQUE0QixTQUFRLHNCQUFTO0lBaUJ4RCxZQUNFLEtBQWdCLEVBQ2hCLEVBQVUsRUFDVixLQUF1Qzs7UUFFdkMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQW5CbkIsYUFBUSxHQUFZLElBQUksQ0FBQztRQVd6QixZQUFPLEdBQVEsRUFBRSxDQUFDO1FBVWhCLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRWpDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQSxLQUFL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QUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsT0FBTyxLQUFJLEVBQUUsQ0FBQztRQUNyQyxNQUFNLFNBQVMsR0FBRyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxTQUFTLEtBQUksRUFBRSxDQUFDO1FBRXpDLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbEMsT0FBTyxFQUFFLEdBQUcsT0FBTyxJQUFJLFNBQVMsTUFBTTtZQUN0QyxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGtCQUFrQjtvQkFDeEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2lCQUMvQzthQUNGO1lBQ0QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQUM7SUFDTCxDQUFDO0NBRUY7QUFsbEJELGtFQWtsQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XHJcbmltcG9ydCB7UnVsZSwgU2NoZWR1bGV9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XHJcbmltcG9ydCB7TGFtYmRhRnVuY3Rpb259IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHNcIjtcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xyXG5pbXBvcnQgKiBhcyBzcXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XHJcbmltcG9ydCAqIGFzIGVjciBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjclwiO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XHJcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XHJcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnNcIjtcclxuaW1wb3J0ICogYXMgYWNtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyXCI7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcidcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbi8vIHsgQ3JlZGVudGlhbHMsIERhdGFiYXNlSW5zdGFuY2UsIERhdGFiYXNlSW5zdGFuY2VFbmdpbmUsIERhdGFiYXNlU2VjcmV0LCBNeXNxbEVuZ2luZVZlcnNpb24gfVxyXG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XHJcbmltcG9ydCAqIGFzIGFwcHJ1bm5lciBmcm9tICdAYXdzLWNkay9hd3MtYXBwcnVubmVyLWFscGhhJztcclxuXHJcbmltcG9ydCB7IE9yaWdpblByb3RvY29sUG9saWN5IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XHJcbmltcG9ydCB7IHRpbWVTdGFtcCB9IGZyb20gXCJjb25zb2xlXCI7XHJcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XHJcbiAgcmVhZG9ubHkgYXBpTmFtZTogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IGFwaURlc2NyaXB0aW9uPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHdlYkRvbWFpbk5hbWU/OiBzdHJpbmc7XHJcbiAgcmVhZG9ubHkgc3RhZ2VOYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBjZGsuRHVyYXRpb247XHJcbiAgcmVhZG9ubHkgbWVtb3J5U2l6ZT86IG51bWJlcjtcclxuICByZWFkb25seSBjZXJ0aWZpY2F0ZUFSTj86IHN0cmluZyB8IG51bGw7XHJcbn1cclxuXHJcbmNvbnN0IGxhbWJkYUhhbmRsZXJOYW1lID1cclxuICBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLkxhbWJkYUhhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIjtcclxuY29uc3QgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUgPSA4MTkyO1xyXG5jb25zdCBsYW1iZGFEZWZhdWx0VGltZW91dCA9IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKTtcclxuY29uc3QgZGVmYXVsdExhbWJkYVJ1bnRpbWUgPSBsYW1iZGEuUnVudGltZS5KQVZBXzExO1xyXG5jb25zdCByZXdyaXRlRWRnZUxhbWJkYUhhbmRsZXJOYW1lID0gXCJyZXdyaXRlLmhhbmRsZXJcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHAgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xyXG4gIGFwcE5hbWU6IHN0cmluZztcclxuICBzdGFnZU5hbWU6IHN0cmluZztcclxuICBpc0RldkVudjogYm9vbGVhbiA9IHRydWU7XHJcbiAgdnBjOiBlYzIuVnBjO1xyXG4gIGRiU2VydmVyOiByZHMuRGF0YWJhc2VJbnN0YW5jZTtcclxuICBpYW1Vc2VyOiBpYW0uVXNlcjtcclxuICBEVGlja2V0OiBkeW5hbW9kYi5UYWJsZTtcclxuICBEQ2FjaGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHF1ZXVlTGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcclxuICBjcm9uTGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcclxuICBsYW1iZGFSb2xlOiBpYW0uUm9sZTtcclxuICBzZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcclxuICBhY2Nlc3NLZXk6IGlhbS5DZm5BY2Nlc3NLZXk7XHJcbiAgZW52VmFyczogYW55ID0ge307XHJcbiAgYXBwUnVubmVyOiBhcHBydW5uZXIuU2VydmljZTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBzY29wZTogQ29uc3RydWN0LFxyXG4gICAgaWQ6IHN0cmluZyxcclxuICAgIHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wc1xyXG4gICkge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcclxuXHJcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcclxuXHJcbiAgICB0aGlzLmFwcE5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgdGhpcy5zdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgaWYgKHRoaXMuYXBwTmFtZS5sZW5ndGggPT0gMCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBUEkgTmFtZSBjYW5ub3QgYmUgZW1wdHlcIik7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuc3RhZ2VOYW1lLmxlbmd0aCA9PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN0YWdlIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIExhbWJkYSBSb2xlXHJcbiAgICB0aGlzLmxhbWJkYVJvbGVDcmVhdGUocHJvcHMpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIElBTSBVc2VyXHJcbiAgICB0aGlzLmlhbVVzZXJDcmVhdGUocHJvcHMpO1xyXG5cclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gVlBDXHJcbiAgICB0aGlzLmNyZWF0ZVZQQyhwcm9wcyk7IFxyXG4gICAgY29uc3QgRHluYW1vR2F0ZXdheUVuZHBvaW50ID0gdGhpcy52cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdEeW5hbW8tZW5kcG9pbnQnLCB7XHJcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFJEUyAtIE15U1FMIDguMFxyXG4gICAgdGhpcy5zZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsIGByZHMtc2dgLCB7XHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWVcclxuICAgIH0pO1xyXG4gICAgdGhpcy5zZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbSggdGhpcy5zZWN1cml0eUdyb3VwLCBlYzIuUG9ydC50Y3AoMzMwNikpO1xyXG4gICAgaWYgKHRoaXMuaXNEZXZFbnYpIHtcclxuICAgICAgLy9BY2Nlc3MgZnJvbSBNeUlQXHJcbiAgICAgIHRoaXMuc2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oIGVjMi5QZWVyLmlwdjQoJzEwMC4xMDAuMTAwLjEwMC8zMicpLCBlYzIuUG9ydC50Y3BSYW5nZSgxLCA2NTUzNSkpOyBcclxuICAgIH1cclxuICAgIHRoaXMuY3JlYXRlREIocHJvcHMpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRHluYW1vXHJcbiAgICB0aGlzLmNyZWF0ZUR5bmFtbyhwcm9wcyk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFVzZXIgZ3JvdXBzIHRvIHNwbGl0IHBvbGljaWVzXHJcbiAgICAvLyBOb3RlOiBNYXhpbXVtIHBvbGljeSBzaXplIG9mIDIwNDggYnl0ZXMgZXhjZWVkZWQgZm9yIHVzZXJcclxuICAgIGNvbnN0IGZlc3RHcm91cCA9IG5ldyBpYW0uR3JvdXAodGhpcywgJ2Zlc3RpdmFsLWdyb3VwLWlkJywge1xyXG4gICAgICBncm91cE5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fZmVzdGdyb3VwYFxyXG4gICAgfSk7XHJcbiAgICBmZXN0R3JvdXAuYWRkVXNlcih0aGlzLmlhbVVzZXIpO1xyXG4gICAgdGhpcy5EQ2FjaGUuZ3JhbnRSZWFkV3JpdGVEYXRhKCBmZXN0R3JvdXApO1xyXG4gICAgdGhpcy5EVGlja2V0LmdyYW50UmVhZFdyaXRlRGF0YSggZmVzdEdyb3VwKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBTUVMgVGlja2V0IFF1ZXVlXHJcbiAgICBjb25zdCB0aWNrZXRRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgYHRpY2tldHF1ZXVlYCwge1xyXG4gICAgICBxdWV1ZU5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fdGlja2V0cXVldWVgXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBFbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgIHRoaXMuZW52VmFyc1tgUkVHSU9OYF0gPSBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9GRVNUSVZBTFRJQ0tFVFNfUVVFVUVVUkxgXSA9IHRpY2tldFF1ZXVlLnF1ZXVlVXJsO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX0RCX1VSTGBdID0gYGpkYmM6bXlzcWw6Ly8ke3RoaXMuZGJTZXJ2ZXIuZGJJbnN0YW5jZUVuZHBvaW50QWRkcmVzc30vZmVzdGl2YWx0aWNrZXRzP3VzZVNTTD1mYWxzZWA7XHJcbiAgICB0aGlzLmVudlZhcnNbYEdYX0RFRkFVTFRfVVNFUl9JRGBdID0gdGhpcy5kYlNlcnZlci5zZWNyZXQ/LnNlY3JldFZhbHVlRnJvbUpzb24oJ3VzZXJuYW1lJyk7XHJcbiAgICB0aGlzLmVudlZhcnNbYEdYX0RFRkFVTFRfVVNFUl9QQVNTV09SRGBdID0gdGhpcy5kYlNlcnZlci5zZWNyZXQ/LnNlY3JldFZhbHVlRnJvbUpzb24oJ3Bhc3N3b3JkJyk7XHJcbiAgICB0aGlzLmVudlZhcnNbYEdYX0RZTkFNT0RCRFNfVVNFUl9JRGBdID0gdGhpcy5hY2Nlc3NLZXkucmVmO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9EWU5BTU9EQkRTX1VTRVJfUEFTU1dPUkRgXSA9IHRoaXMuYWNjZXNzS2V5LmF0dHJTZWNyZXRBY2Nlc3NLZXk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRmVzdGl2YWxUaWNrZXRzIExhbWJkYXMgKFNRUyAmIENST04pXHJcbiAgICB0aGlzLmNyZWF0ZUZlc3RpdmFsVGlja2V0c0xhbWJkYXMoIHByb3BzKTtcclxuXHJcbiAgICAvLyBTb21lIHF1ZXVlIHBlcm1pc3Npb25zXHJcbiAgICB0aWNrZXRRdWV1ZS5ncmFudENvbnN1bWVNZXNzYWdlcyh0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24pO1xyXG4gICAgdGlja2V0UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoZmVzdEdyb3VwKTtcclxuICAgIC8vIExhbWJkYSBxdWV1ZSB0cmlnZ2VyXHJcbiAgICBjb25zdCBldmVudFNvdXJjZSA9IG5ldyBsYW1iZGFFdmVudFNvdXJjZXMuU3FzRXZlbnRTb3VyY2UodGlja2V0UXVldWUpO1xyXG4gICAgdGhpcy5xdWV1ZUxhbWJkYUZ1bmN0aW9uLmFkZEV2ZW50U291cmNlKGV2ZW50U291cmNlKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBBbmd1bGFyIEFwcCBIb3N0XHJcbiAgICAvLyBNYXhpbXVtIHBvbGljeSBzaXplIG9mIDIwNDggYnl0ZXMgZXhjZWVkZWQgZm9yIHVzZXJcclxuICAgIGNvbnN0IGFwcEdyb3VwID0gbmV3IGlhbS5Hcm91cCh0aGlzLCAnYXBwLWdyb3VwLWlkJywge1xyXG4gICAgICBncm91cE5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fYXBwZ3JvdXBgXHJcbiAgICB9KTtcclxuICAgIGFwcEdyb3VwLmFkZFVzZXIodGhpcy5pYW1Vc2VyKTsgICAgXHJcbiAgICBcclxuICAgIGNvbnN0IHdlYnNpdGVQdWJsaWNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tYnVja2V0LXdlYmAsIHtcclxuICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6IFwiaW5kZXguaHRtbFwiLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwcEdyb3VwKTtcclxuICAgIG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xyXG4gICAgICBzdGF0ZW1lbnRzOiBbXHJcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgYWN0aW9uczogW1wic3RzOkFzc3VtZVJvbGVcIl0sXHJcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgfSksXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gU3RvcmFnZVxyXG4gICAgY29uc3Qgc3RvcmFnZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1idWNrZXRgLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRQdXRBY2woYXBwR3JvdXApO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShhcHBHcm91cCk7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEJhY2tlbmQgc2VydmljZXNcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1hcGlnd2AsIHtcclxuICAgICAgZGVzY3JpcHRpb246IGAke3RoaXMuYXBwTmFtZX0gQVBJR2F0ZXdheSBFbmRwb2ludGAsXHJcbiAgICAgIHJlc3RBcGlOYW1lOiB0aGlzLmFwcE5hbWUsXHJcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcclxuICAgICAgICBzdGFnZU5hbWU6IHRoaXMuc3RhZ2VOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIlgtQW16LURhdGVcIixcclxuICAgICAgICAgIFwiQXV0aG9yaXphdGlvblwiLFxyXG4gICAgICAgICAgXCJYLUFwaS1LZXlcIixcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogW1wiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiXSxcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxyXG4gICAgICAgIGFsbG93T3JpZ2luczogW1wiKlwiXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uTmFtZSA9IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1gO1xyXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tZnVuY3Rpb25gLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogbGFtYmRhRnVuY3Rpb25OYW1lLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogbGFtYmRhSGFuZGxlck5hbWUsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IHRoaXMuYXBwTmFtZVxyXG4gICAgICB9JyBTZXJ2ZXJsZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXSxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRENhY2hlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZ1bmN0aW9uKTtcclxuICAgIGxhbWJkYUZ1bmN0aW9uLmdyYW50SW52b2tlKGFwcEdyb3VwKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlID1cclxuICAgICAgbmV3IGNsb3VkZnJvbnQuZXhwZXJpbWVudGFsLkVkZ2VGdW5jdGlvbih0aGlzLCBgJHt0aGlzLmFwcE5hbWV9RWRnZUxhbWJkYWAsIHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6IGAke3RoaXMuYXBwTmFtZX0tJHt0aGlzLnN0YWdlTmFtZX0tRWRnZUxhbWJkYWAsXHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXHJcbiAgICAgICAgaGFuZGxlcjogcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSxcclxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoXCJsYW1iZGFcIiksXHJcbiAgICAgICAgZGVzY3JpcHRpb246IGBHZW5lWHVzIEFuZ3VsYXIgUmV3cml0ZSBMYW1iZGEgZm9yIENsb3VkZnJvbnRgLFxyXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyAgICAgICAgXHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5ncmFudEludm9rZShhcHBHcm91cCk7XHJcbiAgICByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UuYWRkQWxpYXMoXCJsaXZlXCIsIHt9KTtcclxuXHJcbiAgICBjb25zdCBvcmlnaW5Qb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5KFxyXG4gICAgICB0aGlzLFxyXG4gICAgICBgJHt0aGlzLmFwcE5hbWV9SHR0cE9yaWdpblBvbGljeWAsXHJcbiAgICAgIHtcclxuICAgICAgICAvL29yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBcIkdYLUhUVFAtT3JpZ2luLVBvbGljeVwiLFxyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gT3JpZ2luIEh0dHAgUG9saWN5YCxcclxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLmFsbG93TGlzdChcclxuICAgICAgICAgIFwiQWNjZXB0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1DaGFyc2V0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1MYW5ndWFnZVwiLFxyXG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcclxuICAgICAgICAgIFwiR3hUWk9mZnNldFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VJZFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VUeXBlXCIsXHJcbiAgICAgICAgICBcIlJlZmVyZXJcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5hbGwoKSxcclxuICAgICAgfVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBwcm9wcz8uY2VydGlmaWNhdGVBUk5cclxuICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKFxyXG4gICAgICAgICAgdGhpcyxcclxuICAgICAgICAgIFwiQ2xvdWRmcm9udCBDZXJ0aWZpY2F0ZVwiLFxyXG4gICAgICAgICAgcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgICAgKVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCB3ZWJEaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke3RoaXMuYXBwTmFtZX0tY2RuYCxcclxuICAgICAge1xyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gQ2xvdWRmcm9udCBEaXN0cmlidXRpb25gLFxyXG4gICAgICAgIGRvbWFpbk5hbWVzOiBwcm9wcz8ud2ViRG9tYWluTmFtZSA/IFtwcm9wcz8ud2ViRG9tYWluTmFtZV0gOiB1bmRlZmluZWQsXHJcbiAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxyXG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xyXG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih3ZWJzaXRlUHVibGljQnVja2V0KSxcclxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxyXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkNPUlNfUzNfT1JJR0lOLFxyXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XHJcbiAgICAgICAgICAgIGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXHJcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXHJcbiAgICAgICAgICBlZGdlTGFtYmRhczogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgZnVuY3Rpb25WZXJzaW9uOiByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UsXHJcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkxhbWJkYUVkZ2VFdmVudFR5cGUuT1JJR0lOX1JFU1BPTlNFLFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgYXBpRG9tYWluTmFtZSA9IGAke2FwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7c3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcclxuXHJcbiAgICBjb25zdCBhcGlHYXRld2F5T3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlEb21haW5OYW1lLCB7XHJcbiAgICAgIHByb3RvY29sUG9saWN5OiBPcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgd2ViRGlzdHJpYnV0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShhcGkpO1xyXG5cclxuICAgIHdlYkRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcihgLyR7dGhpcy5zdGFnZU5hbWV9LypgLCBhcGlHYXRld2F5T3JpZ2luLCB7XHJcbiAgICAgIGNvbXByZXNzOiB0cnVlLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5BTExPV19BTEwsXHJcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogb3JpZ2luUG9saWN5LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgLy8gR2VuZXJpY1xyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcHBOYW1lXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYXBwTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQXBwbGljYXRpb24gTmFtZVwiLFxyXG4gICAgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN0YWdlTmFtZVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnN0YWdlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RhZ2UgTmFtZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgLy8gQmFja29mZmljZVxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JhY2tvZmZpY2UgLSBBcHBydW5uZXItdXJsJywge1xyXG4gICAgICB2YWx1ZTogJ2h0dHBzOi8vJyArIHRoaXMuYXBwUnVubmVyLnNlcnZpY2VVcmwsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICAvLyBCYWNrZW5kIC0gQXBpIGdhdGV3YXlcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBpVVJMXCIsIHtcclxuICAgICAgdmFsdWU6IGBodHRwczovLyR7d2ViRGlzdHJpYnV0aW9uLmRvbWFpbk5hbWV9LyR7dGhpcy5zdGFnZU5hbWV9L2AsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkJhY2tlbmQgLSBTZXJ2aWNlcyBBUEkgVVJMIChTZXJ2aWNlcyBVUkwpXCIsXHJcbiAgICB9KTtcclxuXHJcblxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgLy8gRnJvbnRlbmQgLSBBbmd1bGFyXHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkZyb250ZW5kLUJ1Y2tldFwiLCB7XHJcbiAgICAgIHZhbHVlOiB3ZWJzaXRlUHVibGljQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkZyb250ZW5kIC0gQnVja2V0IE5hbWUgZm9yIEFuZ3VsYXIgV2ViU2l0ZSBEZXBsb3ltZW50XCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkZyb250ZW5kLVdlYlVSTFwiLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3dlYkRpc3RyaWJ1dGlvbi5kb21haW5OYW1lfWAsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkZyb250ZW5kIC0gV2Vic2l0ZSBVUkxcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU3RvcmFnZS1CdWNrZXRcIiwge1xyXG4gICAgICB2YWx1ZTogc3RvcmFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJTdG9yYWdlIC0gQnVja2V0IGZvciBTdG9yYWdlIFNlcnZpY2VcIixcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICAvLyBEQiAtIFJEUyBNeVNRTFxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEQkVuZFBvaW50XCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuZGJJbnN0YW5jZUVuZHBvaW50QWRkcmVzcyxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIEVuZHBvaW50XCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RCU2VjcmV0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXROYW1lISxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIFNlY3JldCBOYW1lXCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gR2V0IGFjY2VzcyB0byB0aGUgc2VjcmV0IG9iamVjdFxyXG4gICAgLy8gY29uc3QgZGJQYXNzd29yZFNlY3JldCA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxyXG4gICAgLy8gICB0aGlzLFxyXG4gICAgLy8gICAnZGItcHdkLWlkJyxcclxuICAgIC8vICAgdGhpcy5kYlNlcnZlci5zZWNyZXQ/LnNlY3JldE5hbWUhLFxyXG4gICAgLy8gKTtcclxuXHJcbiAgICAvLyBEeW5hbW9cclxuICAgIC8vIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEeW5hbW9EQ2FjaGVUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRDYWNoZS50YWJsZU5hbWUgfSk7XHJcbiAgICAvLyBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vRFRpY2tldFRhYmxlTmFtZScsIHsgdmFsdWU6IHRoaXMuRFRpY2tldC50YWJsZU5hbWUgfSk7XHJcbiAgICBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhIC0gSUFNUm9sZUFSTlwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmxhbWJkYVJvbGUucm9sZUFybixcclxuICAgICAgZGVzY3JpcHRpb246IFwiSUFNIFJvbGUgQVJOXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFjY2Vzc0tleVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFjY2Vzc0tleS5yZWYsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBLZXlcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NTZWNyZXRLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hY2Nlc3NLZXkuYXR0clNlY3JldEFjY2Vzc0tleSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQWNjZXNzIFNlY3JldCBLZXlcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU1FTVGlja2V0VXJsXCIsIHtcclxuICAgICAgdmFsdWU6IHRpY2tldFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJTUVMgVGlja2V0IFVybFwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJMYW1iZGFUaWNrZXRQcm9jZXNzXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMucXVldWVMYW1iZGFGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlRpY2tldCBQcm9jZXNzIExhbWJkYSBOYW1lXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYUNyb25cIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5jcm9uTGFtYmRhRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJUaWNrZXQgUnVmZmxlIExhbWJkYSBDcm9uXCIsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaWFtVXNlckNyZWF0ZShwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIgPSBuZXcgaWFtLlVzZXIodGhpcywgYCR7YXBpTmFtZX0tdXNlcmApO1xyXG5cclxuICAgIC8vIEdlbmVyaWMgUG9saWNpZXNcclxuICAgIC8vIFMzIGd4LWRlcGxveSB3aWxsIGJlIHVzZWQgdG8gZGVwbG95IHRoZSBhcHAgdG8gYXdzXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJzMzoqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW1wiYXJuOmF3czpzMzo6Omd4LWRlcGxveS8qXCIsIFwiYXJuOmF3czpzMzo6Omd4LWRlcGxveSpcIl0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG4gICAgLy8gR3JhbnQgYWNjZXNzIHRvIGFsbCBhcHBsaWNhdGlvbiBsYW1iZGEgZnVuY3Rpb25zXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJsYW1iZGE6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgIGBhcm46YXdzOmxhbWJkYToke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpmdW5jdGlvbjoke2FwaU5hbWV9XypgLFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMuaWFtVXNlci5hZGRUb1BvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGFjdGlvbnM6IFtcImFwaWdhdGV3YXk6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzKmBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJpYW06UGFzc1JvbGVcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5sYW1iZGFSb2xlLnJvbGVBcm5dLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmFjY2Vzc0tleSA9IG5ldyBpYW0uQ2ZuQWNjZXNzS2V5KHRoaXMsIGAke2FwaU5hbWV9LWFjY2Vzc2tleWAsIHtcclxuICAgICAgdXNlck5hbWU6IHRoaXMuaWFtVXNlci51c2VyTmFtZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBsYW1iZGFSb2xlQ3JlYXRlKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICB0aGlzLmxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgYGxhbWJkYS1yb2xlYCwge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxyXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJidWlsZC5hcHBydW5uZXIuYW1hem9uYXdzLmNvbVwiKVxyXG4gICAgICApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJHZW5lWHVzIFNlcnZlcmxlc3MgQXBwbGljYXRpb24gTGFtYmRhIFJvbGVcIixcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFTUVNRdWV1ZUV4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTQXBwUnVubmVyU2VydmljZVBvbGljeUZvckVDUkFjY2Vzc1wiXHJcbiAgICAgICAgKVxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW8ocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IGFwaU5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIC8vIFRPRE86IFZlciBzaSBlbiBhbGfDum4gbW9tZW50byBHeCBpbXBsZW1lbnRhIGVsIGNhbWJpbyBkZSBub21icmUgZW4gdGFibGFzIGVuIGRhdGF2aWV3c1xyXG4gICAgLy8gUGFydGl0aW9ua2V5IFwiaWRcIiBwb3IgY29tcGF0aWJpbGlkYWQgY29uIGNvc21vcyBkYlxyXG4gICAgdGhpcy5EQ2FjaGUgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEQ2FjaGVgLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYERDYWNoZWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLkRUaWNrZXQgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEVGlja2V0YCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEVGlja2V0YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuRFRpY2tldC5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1RpY2tldENvZGVJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge25hbWU6ICdEVGlja2V0Q29kZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HfSxcclxuICAgICAgcmVhZENhcGFjaXR5OiAxLFxyXG4gICAgICB3cml0ZUNhcGFjaXR5OiAxLFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5EVGlja2V0LmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRW1haWxJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge25hbWU6ICdERXZlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSfSxcclxuICAgICAgc29ydEtleToge25hbWU6ICdEVXNlckVtYWlsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkd9LFxyXG4gICAgICByZWFkQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHdyaXRlQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuICB9XHJcbiAgcHJpdmF0ZSBjcmVhdGVGZXN0aXZhbFRpY2tldHNMYW1iZGFzKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICB0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGBUaWNrZXRQcm9jZXNzYCwge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwaU5hbWV9XyR7c3RhZ2VOYW1lfV9UaWNrZXRQcm9jZXNzYCxcclxuICAgICAgZW52aXJvbm1lbnQ6IHRoaXMuZW52VmFycyxcclxuICAgICAgcnVudGltZTogZGVmYXVsdExhbWJkYVJ1bnRpbWUsXHJcbiAgICAgIGhhbmRsZXI6IFwiY29tLmdlbmV4dXMuY2xvdWQuc2VydmVybGVzcy5hd3MuaGFuZGxlci5MYW1iZGFTUVNIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCIsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgUXVldWUgVGlja2V0IFByb2Nlc3MgTGFtYmRhIGZ1bmN0aW9uYCxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIENST05cclxuICAgIHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBgQ3JvbkxhbWJkYWAsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fQ3JvbmAsXHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIHJ1bnRpbWU6IGRlZmF1bHRMYW1iZGFSdW50aW1lLFxyXG4gICAgICBoYW5kbGVyOiBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLmhhbmRsZXIuTGFtYmRhRXZlbnRCcmlkZ2VIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCIsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgQ3JvbiBQcm9jZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG4gICAgLy9FdmVudEJyaWRnZSBydWxlIHdoaWNoIHJ1bnMgZXZlcnkgZml2ZSBtaW51dGVzXHJcbiAgICBjb25zdCBjcm9uUnVsZSA9IG5ldyBSdWxlKHRoaXMsICdDcm9uUnVsZScsIHtcclxuICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmV4cHJlc3Npb24oJ2Nyb24oMC8xMCAqICogKiA/ICopJylcclxuICAgIH0pXHJcbiAgICBjcm9uUnVsZS5hZGRUYXJnZXQobmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZURCKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICBjb25zdCBpbnN0YW5jZUlkZW50aWZpZXIgPSBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tZGJgO1xyXG5cclxuICAgIHRoaXMuZGJTZXJ2ZXIgPSBuZXcgcmRzLkRhdGFiYXNlSW5zdGFuY2UodGhpcywgYCR7YXBpTmFtZX0tZGJgLCB7XHJcbiAgICAgIHB1YmxpY2x5QWNjZXNzaWJsZTogdGhpcy5pc0RldkVudixcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIG9uZVBlckF6OiB0cnVlLFxyXG4gICAgICAgIHN1Ym5ldFR5cGU6IHRoaXMuaXNEZXZFbnYgPyBlYzIuU3VibmV0VHlwZS5QVUJMSUMgOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfTkFUXHJcbiAgICAgIH0sXHJcbiAgICAgIGNyZWRlbnRpYWxzOiByZHMuQ3JlZGVudGlhbHMuZnJvbUdlbmVyYXRlZFNlY3JldCgnZGJhZG1pbicpLFxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBwb3J0OiAzMzA2LFxyXG4gICAgICBkYXRhYmFzZU5hbWU6ICdmZXN0aXZhbHRpY2tldHMnLFxyXG4gICAgICBhbGxvY2F0ZWRTdG9yYWdlOiAyMCxcclxuICAgICAgaW5zdGFuY2VJZGVudGlmaWVyLFxyXG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUluc3RhbmNlRW5naW5lLm15c3FsKHtcclxuICAgICAgICB2ZXJzaW9uOiByZHMuTXlzcWxFbmdpbmVWZXJzaW9uLlZFUl84XzBcclxuICAgICAgfSksXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXSxcclxuICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlQ0RywgZWMyLkluc3RhbmNlU2l6ZS5NSUNSTyksXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IHRoaXMuaXNEZXZFbnYgPyBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIDogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOXHJcbiAgICB9KVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVCYWNrb29maWNlKCl7ICAgIFxyXG4gICAgY29uc3QgdnBjQ29ubmVjdG9yID0gbmV3IGFwcHJ1bm5lci5WcGNDb25uZWN0b3IodGhpcywgJ1ZwY0Nvbm5lY3RvcicsIHtcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgdnBjU3VibmV0czogdGhpcy52cGMuc2VsZWN0U3VibmV0cyh7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSksXHJcbiAgICAgIHZwY0Nvbm5lY3Rvck5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fVnBjQ29ubmVjdG9yYCxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt0aGlzLnNlY3VyaXR5R3JvdXBdXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFwcFJ1bm5lciA9IG5ldyBhcHBydW5uZXIuU2VydmljZSh0aGlzLCAnRnJvbnRlbmQtQXBwcnVubmVyJywge1xyXG4gICAgICBzZXJ2aWNlTmFtZTogYCR7dGhpcy5hcHBOYW1lfV8ke3RoaXMuc3RhZ2VOYW1lfV9mcm9udGVuZGAsXHJcbiAgICAgIHNvdXJjZTogYXBwcnVubmVyLlNvdXJjZS5mcm9tRWNyKHtcclxuICAgICAgICBpbWFnZUNvbmZpZ3VyYXRpb246IHsgcG9ydDogODA4MCB9LFxyXG4gICAgICAgIHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZSh0aGlzLCAnYmFja29mZmljZS1yZXBvJywgYCR7dGhpcy5hcHBOYW1lfV8ke3RoaXMuc3RhZ2VOYW1lfV9iYWNrb2ZmaWNlYCksXHJcbiAgICAgICAgdGFnT3JEaWdlc3Q6ICdsYXRlc3QnLFxyXG4gICAgICB9KSxcclxuICAgICAgdnBjQ29ubmVjdG9yLFxyXG4gICAgICBhY2Nlc3NSb2xlOiB0aGlzLmxhbWJkYVJvbGVcclxuICAgIH0pO1xyXG4gIH1cclxuICBwcml2YXRlIGNyZWF0ZVZQQyhwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy52cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCBgdnBjYCwge1xyXG4gICAgICB2cGNOYW1lOiBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tdnBjYCxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGVfaXNvbGF0ZWQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU1xyXG4gICAgICAgIH1cclxuICAgICAgXSxcclxuICAgICAgbWF4QXpzOiAyXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG59XHJcbiJdfQ==