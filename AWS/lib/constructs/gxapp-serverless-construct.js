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
        // Backoffice
        this.createBackoofice();
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
            value: `https://${this.appRunner.serviceUrl}`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5REFBeUQ7QUFDekQsbUNBQW1DO0FBQ25DLHVEQUFzRDtBQUN0RCx1RUFBOEQ7QUFDOUQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyRUFBMkU7QUFDM0UseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQyx5REFBeUQ7QUFDekQsOERBQThEO0FBQzlELDBEQUEwRDtBQUMxRCw2Q0FBNkM7QUFFN0MsMkNBQXVDO0FBQ3ZDLGdHQUFnRztBQUNoRywyQ0FBMkM7QUFDM0MsMERBQTBEO0FBRTFELCtEQUFrRTtBQWNsRSxNQUFNLGlCQUFpQixHQUNyQiwrREFBK0QsQ0FBQztBQUNsRSxNQUFNLHVCQUF1QixHQUFHLElBQUksQ0FBQztBQUNyQyxNQUFNLG9CQUFvQixHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3RELE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDcEQsTUFBTSw0QkFBNEIsR0FBRyxpQkFBaUIsQ0FBQztBQUV2RCxNQUFhLDJCQUE0QixTQUFRLHNCQUFTO0lBaUJ4RCxZQUNFLEtBQWdCLEVBQ2hCLEVBQVUsRUFDVixLQUF1Qzs7UUFFdkMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQW5CbkIsYUFBUSxHQUFZLElBQUksQ0FBQztRQVd6QixZQUFPLEdBQVEsRUFBRSxDQUFDO1FBVWhCLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRWpDLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQSxLQUFL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U0FBUyxDQUFDLEtBQXVDO1FBQ3ZELE1BQU0sT0FBTyxHQUFHLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE9BQU8sS0FBSSxFQUFFLENBQUM7UUFDckMsTUFBTSxTQUFTLEdBQUcsQ0FBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsU0FBUyxLQUFJLEVBQUUsQ0FBQztRQUV6QyxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ2xDLE9BQU8sRUFBRSxHQUFHLE9BQU8sSUFBSSxTQUFTLE1BQU07WUFDdEMsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxrQkFBa0I7b0JBQ3hCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7YUFDRjtZQUNELE1BQU0sRUFBRSxDQUFDO1NBQ1YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUVGO0FBcmxCRCxrRUFxbEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcclxuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xyXG5pbXBvcnQge1J1bGUsIFNjaGVkdWxlfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50c1wiO1xyXG5pbXBvcnQge0xhbWJkYUZ1bmN0aW9ufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzXCI7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xyXG5pbXBvcnQgKiBhcyBlY3IgZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3JcIjtcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xyXG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xyXG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zXCI7XHJcbmltcG9ydCAqIGFzIGFjbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xyXG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInXHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG4vLyB7IENyZWRlbnRpYWxzLCBEYXRhYmFzZUluc3RhbmNlLCBEYXRhYmFzZUluc3RhbmNlRW5naW5lLCBEYXRhYmFzZVNlY3JldCwgTXlzcWxFbmdpbmVWZXJzaW9uIH1cclxuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xyXG5pbXBvcnQgKiBhcyBhcHBydW5uZXIgZnJvbSAnQGF3cy1jZGsvYXdzLWFwcHJ1bm5lci1hbHBoYSc7XHJcblxyXG5pbXBvcnQgeyBPcmlnaW5Qcm90b2NvbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xyXG5pbXBvcnQgeyB0aW1lU3RhbXAgfSBmcm9tIFwiY29uc29sZVwiO1xyXG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xyXG4gIHJlYWRvbmx5IGFwaU5hbWU6IHN0cmluZztcclxuICByZWFkb25seSBhcGlEZXNjcmlwdGlvbj86IHN0cmluZztcclxuICByZWFkb25seSB3ZWJEb21haW5OYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHN0YWdlTmFtZT86IHN0cmluZztcclxuICByZWFkb25seSB0aW1lb3V0PzogY2RrLkR1cmF0aW9uO1xyXG4gIHJlYWRvbmx5IG1lbW9yeVNpemU/OiBudW1iZXI7XHJcbiAgcmVhZG9ubHkgY2VydGlmaWNhdGVBUk4/OiBzdHJpbmcgfCBudWxsO1xyXG59XHJcblxyXG5jb25zdCBsYW1iZGFIYW5kbGVyTmFtZSA9XHJcbiAgXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5MYW1iZGFIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCI7XHJcbmNvbnN0IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplID0gODE5MjtcclxuY29uc3QgbGFtYmRhRGVmYXVsdFRpbWVvdXQgPSBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCk7XHJcbmNvbnN0IGRlZmF1bHRMYW1iZGFSdW50aW1lID0gbGFtYmRhLlJ1bnRpbWUuSkFWQV8xMTtcclxuY29uc3QgcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSA9IFwicmV3cml0ZS5oYW5kbGVyXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwIGV4dGVuZHMgQ29uc3RydWN0IHtcclxuICBhcHBOYW1lOiBzdHJpbmc7XHJcbiAgc3RhZ2VOYW1lOiBzdHJpbmc7XHJcbiAgaXNEZXZFbnY6IGJvb2xlYW4gPSB0cnVlO1xyXG4gIHZwYzogZWMyLlZwYztcclxuICBkYlNlcnZlcjogcmRzLkRhdGFiYXNlSW5zdGFuY2U7XHJcbiAgaWFtVXNlcjogaWFtLlVzZXI7XHJcbiAgRFRpY2tldDogZHluYW1vZGIuVGFibGU7XHJcbiAgRENhY2hlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBxdWV1ZUxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgY3JvbkxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgbGFtYmRhUm9sZTogaWFtLlJvbGU7XHJcbiAgc2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XHJcbiAgYWNjZXNzS2V5OiBpYW0uQ2ZuQWNjZXNzS2V5O1xyXG4gIGVudlZhcnM6IGFueSA9IHt9O1xyXG4gIGFwcFJ1bm5lcjogYXBwcnVubmVyLlNlcnZpY2U7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgICBwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHNcclxuICApIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCk7XHJcblxyXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XHJcblxyXG4gICAgdGhpcy5hcHBOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIHRoaXMuc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIGlmICh0aGlzLmFwcE5hbWUubGVuZ3RoID09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQVBJIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLnN0YWdlTmFtZS5sZW5ndGggPT0gMCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTdGFnZSBOYW1lIGNhbm5vdCBiZSBlbXB0eVwiKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBMYW1iZGEgUm9sZVxyXG4gICAgdGhpcy5sYW1iZGFSb2xlQ3JlYXRlKHByb3BzKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBJQU0gVXNlclxyXG4gICAgdGhpcy5pYW1Vc2VyQ3JlYXRlKHByb3BzKTtcclxuXHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFZQQ1xyXG4gICAgdGhpcy5jcmVhdGVWUEMocHJvcHMpOyBcclxuICAgIGNvbnN0IER5bmFtb0dhdGV3YXlFbmRwb2ludCA9IHRoaXMudnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vLWVuZHBvaW50Jywge1xyXG4gICAgICBzZXJ2aWNlOiBlYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5EWU5BTU9EQlxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBSRFMgLSBNeVNRTCA4LjBcclxuICAgIHRoaXMuc2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCBgcmRzLXNnYCwge1xyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlXHJcbiAgICB9KTtcclxuICAgIHRoaXMuc2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oIHRoaXMuc2VjdXJpdHlHcm91cCwgZWMyLlBvcnQudGNwKDMzMDYpKTtcclxuICAgIGlmICh0aGlzLmlzRGV2RW52KSB7XHJcbiAgICAgIC8vQWNjZXNzIGZyb20gTXlJUFxyXG4gICAgICB0aGlzLnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKCBlYzIuUGVlci5pcHY0KCcxMDAuMTAwLjEwMC4xMDAvMzInKSwgZWMyLlBvcnQudGNwUmFuZ2UoMSwgNjU1MzUpKTsgXHJcbiAgICB9XHJcbiAgICB0aGlzLmNyZWF0ZURCKHByb3BzKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIER5bmFtb1xyXG4gICAgdGhpcy5jcmVhdGVEeW5hbW8ocHJvcHMpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBVc2VyIGdyb3VwcyB0byBzcGxpdCBwb2xpY2llc1xyXG4gICAgLy8gTm90ZTogTWF4aW11bSBwb2xpY3kgc2l6ZSBvZiAyMDQ4IGJ5dGVzIGV4Y2VlZGVkIGZvciB1c2VyXHJcbiAgICBjb25zdCBmZXN0R3JvdXAgPSBuZXcgaWFtLkdyb3VwKHRoaXMsICdmZXN0aXZhbC1ncm91cC1pZCcsIHtcclxuICAgICAgZ3JvdXBOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2Zlc3Rncm91cGBcclxuICAgIH0pO1xyXG4gICAgZmVzdEdyb3VwLmFkZFVzZXIodGhpcy5pYW1Vc2VyKTtcclxuICAgIHRoaXMuRENhY2hlLmdyYW50UmVhZFdyaXRlRGF0YSggZmVzdEdyb3VwKTtcclxuICAgIHRoaXMuRFRpY2tldC5ncmFudFJlYWRXcml0ZURhdGEoIGZlc3RHcm91cCk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gU1FTIFRpY2tldCBRdWV1ZVxyXG4gICAgY29uc3QgdGlja2V0UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIGB0aWNrZXRxdWV1ZWAsIHtcclxuICAgICAgcXVldWVOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X3RpY2tldHF1ZXVlYFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICB0aGlzLmVudlZhcnNbYFJFR0lPTmBdID0gY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRkVTVElWQUxUSUNLRVRTX1FVRVVFVVJMYF0gPSB0aWNrZXRRdWV1ZS5xdWV1ZVVybDtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfREVGQVVMVF9EQl9VUkxgXSA9IGBqZGJjOm15c3FsOi8vJHt0aGlzLmRiU2VydmVyLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3N9L2Zlc3RpdmFsdGlja2V0cz91c2VTU0w9ZmFsc2VgO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfSURgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCd1c2VybmFtZScpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfUEFTU1dPUkRgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCdwYXNzd29yZCcpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9EWU5BTU9EQkRTX1VTRVJfSURgXSA9IHRoaXMuYWNjZXNzS2V5LnJlZjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRFlOQU1PREJEU19VU0VSX1BBU1NXT1JEYF0gPSB0aGlzLmFjY2Vzc0tleS5hdHRyU2VjcmV0QWNjZXNzS2V5O1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEZlc3RpdmFsVGlja2V0cyBMYW1iZGFzIChTUVMgJiBDUk9OKVxyXG4gICAgdGhpcy5jcmVhdGVGZXN0aXZhbFRpY2tldHNMYW1iZGFzKCBwcm9wcyk7XHJcblxyXG4gICAgLy8gU29tZSBxdWV1ZSBwZXJtaXNzaW9uc1xyXG4gICAgdGlja2V0UXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXModGhpcy5xdWV1ZUxhbWJkYUZ1bmN0aW9uKTtcclxuICAgIHRpY2tldFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGZlc3RHcm91cCk7XHJcbiAgICAvLyBMYW1iZGEgcXVldWUgdHJpZ2dlclxyXG4gICAgY29uc3QgZXZlbnRTb3VyY2UgPSBuZXcgbGFtYmRhRXZlbnRTb3VyY2VzLlNxc0V2ZW50U291cmNlKHRpY2tldFF1ZXVlKTtcclxuICAgIHRoaXMucXVldWVMYW1iZGFGdW5jdGlvbi5hZGRFdmVudFNvdXJjZShldmVudFNvdXJjZSk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQW5ndWxhciBBcHAgSG9zdFxyXG4gICAgLy8gTWF4aW11bSBwb2xpY3kgc2l6ZSBvZiAyMDQ4IGJ5dGVzIGV4Y2VlZGVkIGZvciB1c2VyXHJcbiAgICBjb25zdCBhcHBHcm91cCA9IG5ldyBpYW0uR3JvdXAodGhpcywgJ2FwcC1ncm91cC1pZCcsIHtcclxuICAgICAgZ3JvdXBOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2FwcGdyb3VwYFxyXG4gICAgfSk7XHJcbiAgICBhcHBHcm91cC5hZGRVc2VyKHRoaXMuaWFtVXNlcik7ICAgIFxyXG4gICAgXHJcbiAgICBjb25zdCB3ZWJzaXRlUHVibGljQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBgJHt0aGlzLmFwcE5hbWV9LWJ1Y2tldC13ZWJgLCB7XHJcbiAgICAgIHdlYnNpdGVJbmRleERvY3VtZW50OiBcImluZGV4Lmh0bWxcIixcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG4gICAgd2Vic2l0ZVB1YmxpY0J1Y2tldC5ncmFudFB1YmxpY0FjY2VzcygpO1xyXG4gICAgd2Vic2l0ZVB1YmxpY0J1Y2tldC5ncmFudFJlYWRXcml0ZShhcHBHcm91cCk7XHJcbiAgICBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlXCJdLFxyXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFN0b3JhZ2VcclxuICAgIGNvbnN0IHN0b3JhZ2VCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tYnVja2V0YCwge1xyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UHV0QWNsKGFwcEdyb3VwKTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBwR3JvdXApO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFB1YmxpY0FjY2VzcygpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBCYWNrZW5kIHNlcnZpY2VzXHJcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tYXBpZ3dgLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJHt0aGlzLmFwcE5hbWV9IEFQSUdhdGV3YXkgRW5kcG9pbnRgLFxyXG4gICAgICByZXN0QXBpTmFtZTogdGhpcy5hcHBOYW1lLFxyXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XHJcbiAgICAgICAgc3RhZ2VOYW1lOiB0aGlzLnN0YWdlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XHJcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXHJcbiAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiLFxyXG4gICAgICAgICAgXCJYLUFtei1EYXRlXCIsXHJcbiAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcclxuICAgICAgICAgIFwiWC1BcGktS2V5XCIsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBhbGxvd01ldGhvZHM6IFtcIk9QVElPTlNcIiwgXCJHRVRcIiwgXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIl0sXHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcclxuICAgICAgICBhbGxvd09yaWdpbnM6IFtcIipcIl0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBsYW1iZGFGdW5jdGlvbk5hbWUgPSBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9YDtcclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBgJHt0aGlzLmFwcE5hbWV9LWZ1bmN0aW9uYCwge1xyXG4gICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZWYXJzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6IGxhbWJkYUZ1bmN0aW9uTmFtZSxcclxuICAgICAgcnVudGltZTogZGVmYXVsdExhbWJkYVJ1bnRpbWUsXHJcbiAgICAgIGhhbmRsZXI6IGxhbWJkYUhhbmRsZXJOYW1lLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IHRoaXMubGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCB0aGlzLmFwcE5hbWVcclxuICAgICAgfScgU2VydmVybGVzcyBMYW1iZGEgZnVuY3Rpb25gLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF0sXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLkRDYWNoZS5ncmFudFJlYWRXcml0ZURhdGEobGFtYmRhRnVuY3Rpb24pO1xyXG4gICAgdGhpcy5EVGlja2V0LmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICBsYW1iZGFGdW5jdGlvbi5ncmFudEludm9rZShhcHBHcm91cCk7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiYXBpZ2F0ZXdheToqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgYGFybjphd3M6YXBpZ2F0ZXdheToke3N0YWNrLnJlZ2lvbn06Oi9yZXN0YXBpcy8ke2FwaS5yZXN0QXBpSWR9KmAsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZSA9XHJcbiAgICAgIG5ldyBjbG91ZGZyb250LmV4cGVyaW1lbnRhbC5FZGdlRnVuY3Rpb24odGhpcywgYCR7dGhpcy5hcHBOYW1lfUVkZ2VMYW1iZGFgLCB7XHJcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgJHt0aGlzLmFwcE5hbWV9LSR7dGhpcy5zdGFnZU5hbWV9LUVkZ2VMYW1iZGFgLFxyXG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xNF9YLFxyXG4gICAgICAgIGhhbmRsZXI6IHJld3JpdGVFZGdlTGFtYmRhSGFuZGxlck5hbWUsXHJcbiAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KFwibGFtYmRhXCIpLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgR2VuZVh1cyBBbmd1bGFyIFJld3JpdGUgTGFtYmRhIGZvciBDbG91ZGZyb250YCxcclxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5GSVZFX0RBWVMgICAgICAgIFxyXG4gICAgICB9KTtcclxuXHJcbiAgICByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UuZ3JhbnRJbnZva2UoYXBwR3JvdXApO1xyXG4gICAgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlLmFkZEFsaWFzKFwibGl2ZVwiLCB7fSk7XHJcblxyXG4gICAgY29uc3Qgb3JpZ2luUG9saWN5ID0gbmV3IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeShcclxuICAgICAgdGhpcyxcclxuICAgICAgYCR7dGhpcy5hcHBOYW1lfUh0dHBPcmlnaW5Qb2xpY3lgLFxyXG4gICAgICB7XHJcbiAgICAgICAgLy9vcmlnaW5SZXF1ZXN0UG9saWN5TmFtZTogXCJHWC1IVFRQLU9yaWdpbi1Qb2xpY3lcIixcclxuICAgICAgICBjb21tZW50OiBgJHt0aGlzLmFwcE5hbWV9IE9yaWdpbiBIdHRwIFBvbGljeWAsXHJcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5hbGxvd0xpc3QoXHJcbiAgICAgICAgICBcIkFjY2VwdFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtQ2hhcnNldFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtTGFuZ3VhZ2VcIixcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIkd4VFpPZmZzZXRcIixcclxuICAgICAgICAgIFwiRGV2aWNlSWRcIixcclxuICAgICAgICAgIFwiRGV2aWNlVHlwZVwiLFxyXG4gICAgICAgICAgXCJSZWZlcmVyXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpLFxyXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgIH1cclxuICAgICk7XHJcbiAgICBcclxuICAgIGNvbnN0IGNlcnRpZmljYXRlID0gcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgID8gYWNtLkNlcnRpZmljYXRlLmZyb21DZXJ0aWZpY2F0ZUFybihcclxuICAgICAgICAgIHRoaXMsXHJcbiAgICAgICAgICBcIkNsb3VkZnJvbnQgQ2VydGlmaWNhdGVcIixcclxuICAgICAgICAgIHByb3BzPy5jZXJ0aWZpY2F0ZUFSTlxyXG4gICAgICAgIClcclxuICAgICAgOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgY29uc3Qgd2ViRGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKFxyXG4gICAgICB0aGlzLFxyXG4gICAgICBgJHt0aGlzLmFwcE5hbWV9LWNkbmAsXHJcbiAgICAgIHtcclxuICAgICAgICBjb21tZW50OiBgJHt0aGlzLmFwcE5hbWV9IENsb3VkZnJvbnQgRGlzdHJpYnV0aW9uYCxcclxuICAgICAgICBkb21haW5OYW1lczogcHJvcHM/LndlYkRvbWFpbk5hbWUgPyBbcHJvcHM/LndlYkRvbWFpbk5hbWVdIDogdW5kZWZpbmVkLFxyXG4gICAgICAgIGNlcnRpZmljYXRlOiBjZXJ0aWZpY2F0ZSxcclxuICAgICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcclxuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4od2Vic2l0ZVB1YmxpY0J1Y2tldCksXHJcbiAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcclxuICAgICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5DT1JTX1MzX09SSUdJTixcclxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OlxyXG4gICAgICAgICAgICBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxyXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxyXG4gICAgICAgICAgZWRnZUxhbWJkYXM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIGZ1bmN0aW9uVmVyc2lvbjogcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlLFxyXG4gICAgICAgICAgICAgIGV2ZW50VHlwZTogY2xvdWRmcm9udC5MYW1iZGFFZGdlRXZlbnRUeXBlLk9SSUdJTl9SRVNQT05TRSxcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICB9XHJcbiAgICApO1xyXG5cclxuICAgIGNvbnN0IGFwaURvbWFpbk5hbWUgPSBgJHthcGkucmVzdEFwaUlkfS5leGVjdXRlLWFwaS4ke3N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWA7XHJcblxyXG4gICAgY29uc3QgYXBpR2F0ZXdheU9yaWdpbiA9IG5ldyBvcmlnaW5zLkh0dHBPcmlnaW4oYXBpRG9tYWluTmFtZSwge1xyXG4gICAgICBwcm90b2NvbFBvbGljeTogT3JpZ2luUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcclxuICAgIH0pO1xyXG5cclxuICAgIHdlYkRpc3RyaWJ1dGlvbi5ub2RlLmFkZERlcGVuZGVuY3koYXBpKTtcclxuXHJcbiAgICB3ZWJEaXN0cmlidXRpb24uYWRkQmVoYXZpb3IoYC8ke3RoaXMuc3RhZ2VOYW1lfS8qYCwgYXBpR2F0ZXdheU9yaWdpbiwge1xyXG4gICAgICBjb21wcmVzczogdHJ1ZSxcclxuICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuQUxMT1dfQUxMLFxyXG4gICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXHJcbiAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXHJcbiAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IG9yaWdpblBvbGljeSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEJhY2tvZmZpY2VcclxuICAgIHRoaXMuY3JlYXRlQmFja29vZmljZSgpO1xyXG5cclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIC8vIEdlbmVyaWNcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQXBwTmFtZVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwcE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFwcGxpY2F0aW9uIE5hbWVcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdGFnZU5hbWVcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5zdGFnZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlN0YWdlIE5hbWVcIixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIC8vIEJhY2tvZmZpY2VcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCYWNrb2ZmaWNlIC0gQXBwcnVubmVyLXVybCcsIHtcclxuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5hcHBSdW5uZXIuc2VydmljZVVybH1gLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgLy8gQmFja2VuZCAtIEFwaSBnYXRld2F5XHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVSTFwiLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3dlYkRpc3RyaWJ1dGlvbi5kb21haW5OYW1lfS8ke3RoaXMuc3RhZ2VOYW1lfS9gLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJCYWNrZW5kIC0gU2VydmljZXMgQVBJIFVSTCAoU2VydmljZXMgVVJMKVwiLFxyXG4gICAgfSk7XHJcblxyXG5cclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIC8vIEZyb250ZW5kIC0gQW5ndWxhclxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJGcm9udGVuZC1CdWNrZXRcIiwge1xyXG4gICAgICB2YWx1ZTogd2Vic2l0ZVB1YmxpY0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJGcm9udGVuZCAtIEJ1Y2tldCBOYW1lIGZvciBBbmd1bGFyIFdlYlNpdGUgRGVwbG95bWVudFwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJGcm9udGVuZC1XZWJVUkxcIiwge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt3ZWJEaXN0cmlidXRpb24uZG9tYWluTmFtZX1gLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJGcm9udGVuZCAtIFdlYnNpdGUgVVJMXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN0b3JhZ2UtQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RvcmFnZSAtIEJ1Y2tldCBmb3IgU3RvcmFnZSBTZXJ2aWNlXCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgLy8gREIgLSBSRFMgTXlTUUxcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiREJFbmRQb2ludFwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmRiU2VydmVyLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3MsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlJEUyBNeVNRTCBFbmRwb2ludFwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEQlNlY3JldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmRiU2VydmVyLnNlY3JldD8uc2VjcmV0TmFtZSEsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlJEUyBNeVNRTCBTZWNyZXQgTmFtZVwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEdldCBhY2Nlc3MgdG8gdGhlIHNlY3JldCBvYmplY3RcclxuICAgIC8vIGNvbnN0IGRiUGFzc3dvcmRTZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcclxuICAgIC8vICAgdGhpcyxcclxuICAgIC8vICAgJ2RiLXB3ZC1pZCcsXHJcbiAgICAvLyAgIHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXROYW1lISxcclxuICAgIC8vICk7XHJcblxyXG4gICAgLy8gRHluYW1vXHJcbiAgICAvLyBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vRENhY2hlVGFibGVOYW1lJywgeyB2YWx1ZTogdGhpcy5EQ2FjaGUudGFibGVOYW1lIH0pO1xyXG4gICAgLy8gbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0R5bmFtb0RUaWNrZXRUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRUaWNrZXQudGFibGVOYW1lIH0pO1xyXG4gICAgXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkxhbWJkYSAtIElBTVJvbGVBUk5cIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5sYW1iZGFSb2xlLnJvbGVBcm4sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIklBTSBSb2xlIEFSTlwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hY2Nlc3NLZXkucmVmLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJBY2Nlc3MgS2V5XCIsXHJcbiAgICB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQWNjZXNzU2VjcmV0S2V5XCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYWNjZXNzS2V5LmF0dHJTZWNyZXRBY2Nlc3NLZXksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBTZWNyZXQgS2V5XCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlNRU1RpY2tldFVybFwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aWNrZXRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU1FTIFRpY2tldCBVcmxcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhVGlja2V0UHJvY2Vzc1wiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJUaWNrZXQgUHJvY2VzcyBMYW1iZGEgTmFtZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJMYW1iZGFDcm9uXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiVGlja2V0IFJ1ZmZsZSBMYW1iZGEgQ3JvblwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlhbVVzZXJDcmVhdGUocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyID0gbmV3IGlhbS5Vc2VyKHRoaXMsIGAke2FwaU5hbWV9LXVzZXJgKTtcclxuXHJcbiAgICAvLyBHZW5lcmljIFBvbGljaWVzXHJcbiAgICAvLyBTMyBneC1kZXBsb3kgd2lsbCBiZSB1c2VkIHRvIGRlcGxveSB0aGUgYXBwIHRvIGF3c1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiczM6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpneC1kZXBsb3kvKlwiLCBcImFybjphd3M6czM6OjpneC1kZXBsb3kqXCJdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIC8vIEdyYW50IGFjY2VzcyB0byBhbGwgYXBwbGljYXRpb24gbGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wibGFtYmRhOipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHthcGlOYW1lfV8qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6YXBpZ2F0ZXdheToke3N0YWNrLnJlZ2lvbn06Oi9yZXN0YXBpcypgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiaWFtOlBhc3NSb2xlXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW3RoaXMubGFtYmRhUm9sZS5yb2xlQXJuXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBuZXcgaWFtLkNmbkFjY2Vzc0tleSh0aGlzLCBgJHthcGlOYW1lfS1hY2Nlc3NrZXlgLCB7XHJcbiAgICAgIHVzZXJOYW1lOiB0aGlzLmlhbVVzZXIudXNlck5hbWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgbGFtYmRhUm9sZUNyZWF0ZShwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgdGhpcy5sYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsIGBsYW1iZGEtcm9sZWAsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXHJcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwibGFtYmRhLmFtYXpvbmF3cy5jb21cIiksXHJcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiYnVpbGQuYXBwcnVubmVyLmFtYXpvbmF3cy5jb21cIilcclxuICAgICAgKSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiR2VuZVh1cyBTZXJ2ZXJsZXNzIEFwcGxpY2F0aW9uIExhbWJkYSBSb2xlXCIsXHJcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFSb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhU1FTUXVldWVFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0FwcFJ1bm5lclNlcnZpY2VQb2xpY3lGb3JFQ1JBY2Nlc3NcIlxyXG4gICAgICAgIClcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlRHluYW1vKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICAvLyBUT0RPOiBWZXIgc2kgZW4gYWxnw7puIG1vbWVudG8gR3ggaW1wbGVtZW50YSBlbCBjYW1iaW8gZGUgbm9tYnJlIGVuIHRhYmxhcyBlbiBkYXRhdmlld3NcclxuICAgIC8vIFBhcnRpdGlvbmtleSBcImlkXCIgcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBjb3Ntb3MgZGJcclxuICAgIHRoaXMuRENhY2hlID0gbmV3IGR5bmFtb2RiLlRhYmxlKCB0aGlzLCBgRENhY2hlYCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEQ2FjaGVgLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5EVGlja2V0ID0gbmV3IGR5bmFtb2RiLlRhYmxlKCB0aGlzLCBgRFRpY2tldGAsIHtcclxuICAgICAgdGFibGVOYW1lOiBgRFRpY2tldGAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLkRUaWNrZXQuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdUaWNrZXRDb2RlSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtuYW1lOiAnRFRpY2tldENvZGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR30sXHJcbiAgICAgIHJlYWRDYXBhY2l0eTogMSxcclxuICAgICAgd3JpdGVDYXBhY2l0eTogMSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuRFRpY2tldC5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtuYW1lOiAnREV2ZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUn0sXHJcbiAgICAgIHNvcnRLZXk6IHtuYW1lOiAnRFVzZXJFbWFpbCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HfSxcclxuICAgICAgcmVhZENhcGFjaXR5OiAxLFxyXG4gICAgICB3cml0ZUNhcGFjaXR5OiAxLFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgY3JlYXRlRmVzdGl2YWxUaWNrZXRzTGFtYmRhcyhwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy5xdWV1ZUxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBgVGlja2V0UHJvY2Vzc2AsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fVGlja2V0UHJvY2Vzc2AsXHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIHJ1bnRpbWU6IGRlZmF1bHRMYW1iZGFSdW50aW1lLFxyXG4gICAgICBoYW5kbGVyOiBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLmhhbmRsZXIuTGFtYmRhU1FTSGFuZGxlcjo6aGFuZGxlUmVxdWVzdFwiLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IHRoaXMubGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCBhcGlOYW1lXHJcbiAgICAgIH0nIFF1ZXVlIFRpY2tldCBQcm9jZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBDUk9OXHJcbiAgICB0aGlzLmNyb25MYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYENyb25MYW1iZGFgLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7YXBpTmFtZX1fJHtzdGFnZU5hbWV9X0Nyb25gLFxyXG4gICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZWYXJzLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5oYW5kbGVyLkxhbWJkYUV2ZW50QnJpZGdlSGFuZGxlcjo6aGFuZGxlUmVxdWVzdFwiLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IHRoaXMubGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCBhcGlOYW1lXHJcbiAgICAgIH0nIENyb24gUHJvY2VzcyBMYW1iZGEgZnVuY3Rpb25gLFxyXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt0aGlzLnNlY3VyaXR5R3JvdXBdXHJcbiAgICB9KTtcclxuICAgIC8vRXZlbnRCcmlkZ2UgcnVsZSB3aGljaCBydW5zIGV2ZXJ5IGZpdmUgbWludXRlc1xyXG4gICAgY29uc3QgY3JvblJ1bGUgPSBuZXcgUnVsZSh0aGlzLCAnQ3JvblJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBTY2hlZHVsZS5leHByZXNzaW9uKCdjcm9uKDAvMTAgKiAqICogPyAqKScpXHJcbiAgICB9KVxyXG4gICAgY3JvblJ1bGUuYWRkVGFyZ2V0KG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLmNyb25MYW1iZGFGdW5jdGlvbikpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEQihwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2VJZGVudGlmaWVyID0gYCR7YXBpTmFtZX0tJHtzdGFnZU5hbWV9LWRiYDtcclxuXHJcbiAgICB0aGlzLmRiU2VydmVyID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsIGAke2FwaU5hbWV9LWRiYCwge1xyXG4gICAgICBwdWJsaWNseUFjY2Vzc2libGU6IHRoaXMuaXNEZXZFbnYsXHJcbiAgICAgIHZwY1N1Ym5ldHM6IHtcclxuICAgICAgICBvbmVQZXJBejogdHJ1ZSxcclxuICAgICAgICBzdWJuZXRUeXBlOiB0aGlzLmlzRGV2RW52ID8gZWMyLlN1Ym5ldFR5cGUuUFVCTElDIDogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX05BVFxyXG4gICAgICB9LFxyXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21HZW5lcmF0ZWRTZWNyZXQoJ2RiYWRtaW4nKSxcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgcG9ydDogMzMwNixcclxuICAgICAgZGF0YWJhc2VOYW1lOiAnZmVzdGl2YWx0aWNrZXRzJyxcclxuICAgICAgYWxsb2NhdGVkU3RvcmFnZTogMjAsXHJcbiAgICAgIGluc3RhbmNlSWRlbnRpZmllcixcclxuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VJbnN0YW5jZUVuZ2luZS5teXNxbCh7XHJcbiAgICAgICAgdmVyc2lvbjogcmRzLk15c3FsRW5naW5lVmVyc2lvbi5WRVJfOF8wXHJcbiAgICAgIH0pLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF0sXHJcbiAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UNEcsIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8pLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmlzRGV2RW52ID8gY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSA6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTlxyXG4gICAgfSlcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlQmFja29vZmljZSgpeyAgICBcclxuICAgIGNvbnN0IHZwY0Nvbm5lY3RvciA9IG5ldyBhcHBydW5uZXIuVnBjQ29ubmVjdG9yKHRoaXMsICdWcGNDb25uZWN0b3InLCB7XHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIHZwY1N1Ym5ldHM6IHRoaXMudnBjLnNlbGVjdFN1Ym5ldHMoeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0pLFxyXG4gICAgICB2cGNDb25uZWN0b3JOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X1ZwY0Nvbm5lY3RvcmAsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hcHBSdW5uZXIgPSBuZXcgYXBwcnVubmVyLlNlcnZpY2UodGhpcywgJ0Zyb250ZW5kLUFwcHJ1bm5lcicsIHtcclxuICAgICAgc2VydmljZU5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fZnJvbnRlbmRgLFxyXG4gICAgICBzb3VyY2U6IGFwcHJ1bm5lci5Tb3VyY2UuZnJvbUVjcih7XHJcbiAgICAgICAgaW1hZ2VDb25maWd1cmF0aW9uOiB7IHBvcnQ6IDgwODAgfSxcclxuICAgICAgICByZXBvc2l0b3J5OiBlY3IuUmVwb3NpdG9yeS5mcm9tUmVwb3NpdG9yeU5hbWUodGhpcywgJ2JhY2tvZmZpY2UtcmVwbycsIGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fYmFja29mZmljZWApLFxyXG4gICAgICAgIHRhZ09yRGlnZXN0OiAnbGF0ZXN0JyxcclxuICAgICAgfSksXHJcbiAgICAgIHZwY0Nvbm5lY3RvcixcclxuICAgICAgYWNjZXNzUm9sZTogdGhpcy5sYW1iZGFSb2xlXHJcbiAgICB9KTtcclxuICB9XHJcbiAgcHJpdmF0ZSBjcmVhdGVWUEMocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IGFwaU5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIHRoaXMudnBjID0gbmV3IGVjMi5WcGModGhpcywgYHZwY2AsIHtcclxuICAgICAgdnBjTmFtZTogYCR7YXBpTmFtZX0tJHtzdGFnZU5hbWV9LXZwY2AsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjaWRyTWFzazogMjQsXHJcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlX2lzb2xhdGVkJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1NcclxuICAgICAgICB9XHJcbiAgICAgIF0sXHJcbiAgICAgIG1heEF6czogMlxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxufVxyXG4iXX0=