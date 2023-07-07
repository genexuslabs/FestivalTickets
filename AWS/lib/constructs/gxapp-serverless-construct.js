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
const { CreateMainVPC } = require('./gxapp-vpc');
const lambdaHandlerName = "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 3008;
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
        this.securityGroup.connections.allowFrom(this.securityGroup, ec2.Port.tcp(3306));
        if (this.isDevEnv) {
            //Access from MyIP
            this.securityGroup.connections.allowFrom(ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535));
        }
        this.createDB(props);
        new cdk.CfnOutput(this, "DBEndPoint", {
            value: this.dbServer.dbInstanceEndpointAddress,
            description: "RDS MySQL Endpoint",
        });
        new cdk.CfnOutput(this, 'DBSecretName', {
            value: (_a = this.dbServer.secret) === null || _a === void 0 ? void 0 : _a.secretName,
            description: "RDS MySQL Secret Name",
        });
        // ---------------------------------
        // Dynamo
        this.createDynamo(props);
        this.DCache.grantReadWriteData(festGroup);
        this.DTicket.grantReadWriteData(festGroup);
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
        this.envVars[`GX_DEFAULT_USER_ID`] = (_b = this.dbServer.secret) === null || _b === void 0 ? void 0 : _b.secretValueFromJson('username');
        this.envVars[`GX_DEFAULT_USER_PASSWORD`] = (_c = this.dbServer.secret) === null || _c === void 0 ? void 0 : _c.secretValueFromJson('password');
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
        this.createFestivalTicketsLambdas(props);
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
        });
        if (this.isDevEnv) {
            console.log(`** AZ ** ${this.vpc.availabilityZones.length}`);
            for (let i = 0; i < this.vpc.availabilityZones.length; i++) {
                this.dbServer.node.addDependency(this.vpc.publicSubnets[i].internetConnectivityEstablished);
            }
        }
    }
    createBackoofice() {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5REFBeUQ7QUFDekQsbUNBQW1DO0FBRW5DLHVEQUFzRDtBQUN0RCx1RUFBOEQ7QUFDOUQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyRUFBMkU7QUFDM0UseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQyx5REFBeUQ7QUFDekQsOERBQThEO0FBQzlELDBEQUEwRDtBQUMxRCw2Q0FBNkM7QUFFN0MsMkNBQXVDO0FBQ3ZDLGdHQUFnRztBQUNoRywyQ0FBMkM7QUFDM0MsMERBQTBEO0FBRTFELCtEQUFrRTtBQUdsRSxNQUFNLEVBQUUsYUFBYSxFQUFFLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0FBR2pELE1BQU0saUJBQWlCLEdBQ3JCLCtEQUErRCxDQUFDO0FBQ2xFLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDO0FBQ3JDLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztBQUNwRCxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFDO0FBRXZELE1BQWEsMkJBQTRCLFNBQVEsc0JBQVM7SUFpQnhELFlBQ0UsS0FBZ0IsRUFDaEIsRUFBVSxFQUNWLEtBQXVDOztRQUV2QyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBbkJuQixhQUFRLEdBQVksSUFBSSxDQUFDO1FBV3pCLFlBQU8sR0FBUSxFQUFFLENBQUM7UUFVaEIsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFF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QkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGtCQUFrQjtvQkFDeEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2lCQUMvQzthQUNGO1lBQ0QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQUM7SUFDTCxDQUFDO0NBRUY7QUE5bEJELGtFQThsQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XHJcbmltcG9ydCB7IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzIH0gZnJvbSAnLi9HZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyc7XHJcbmltcG9ydCB7UnVsZSwgU2NoZWR1bGV9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XHJcbmltcG9ydCB7TGFtYmRhRnVuY3Rpb259IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHNcIjtcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xyXG5pbXBvcnQgKiBhcyBzcXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XHJcbmltcG9ydCAqIGFzIGVjciBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjclwiO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XHJcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XHJcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnNcIjtcclxuaW1wb3J0ICogYXMgYWNtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyXCI7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcidcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbi8vIHsgQ3JlZGVudGlhbHMsIERhdGFiYXNlSW5zdGFuY2UsIERhdGFiYXNlSW5zdGFuY2VFbmdpbmUsIERhdGFiYXNlU2VjcmV0LCBNeXNxbEVuZ2luZVZlcnNpb24gfVxyXG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XHJcbmltcG9ydCAqIGFzIGFwcHJ1bm5lciBmcm9tICdAYXdzLWNkay9hd3MtYXBwcnVubmVyLWFscGhhJztcclxuXHJcbmltcG9ydCB7IE9yaWdpblByb3RvY29sUG9saWN5IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XHJcbmltcG9ydCB7IHRpbWVTdGFtcCB9IGZyb20gXCJjb25zb2xlXCI7XHJcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcclxuY29uc3QgeyBDcmVhdGVNYWluVlBDIH0gPSByZXF1aXJlKCcuL2d4YXBwLXZwYycpO1xyXG5cclxuXHJcbmNvbnN0IGxhbWJkYUhhbmRsZXJOYW1lID1cclxuICBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLkxhbWJkYUhhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIjtcclxuY29uc3QgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUgPSAzMDA4O1xyXG5jb25zdCBsYW1iZGFEZWZhdWx0VGltZW91dCA9IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKTtcclxuY29uc3QgZGVmYXVsdExhbWJkYVJ1bnRpbWUgPSBsYW1iZGEuUnVudGltZS5KQVZBXzExO1xyXG5jb25zdCByZXdyaXRlRWRnZUxhbWJkYUhhbmRsZXJOYW1lID0gXCJyZXdyaXRlLmhhbmRsZXJcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHAgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xyXG4gIGFwcE5hbWU6IHN0cmluZztcclxuICBzdGFnZU5hbWU6IHN0cmluZztcclxuICBpc0RldkVudjogYm9vbGVhbiA9IHRydWU7XHJcbiAgdnBjOiBlYzIuVnBjO1xyXG4gIGRiU2VydmVyOiByZHMuRGF0YWJhc2VJbnN0YW5jZTtcclxuICBpYW1Vc2VyOiBpYW0uVXNlcjtcclxuICBEVGlja2V0OiBkeW5hbW9kYi5UYWJsZTtcclxuICBEQ2FjaGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHF1ZXVlTGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcclxuICBjcm9uTGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcclxuICBsYW1iZGFSb2xlOiBpYW0uUm9sZTtcclxuICBzZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcclxuICBhY2Nlc3NLZXk6IGlhbS5DZm5BY2Nlc3NLZXk7XHJcbiAgZW52VmFyczogYW55ID0ge307XHJcbiAgYXBwUnVubmVyOiBhcHBydW5uZXIuU2VydmljZTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBzY29wZTogQ29uc3RydWN0LFxyXG4gICAgaWQ6IHN0cmluZyxcclxuICAgIHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wc1xyXG4gICkge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcclxuXHJcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcclxuXHJcbiAgICB0aGlzLmFwcE5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgdGhpcy5zdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgaWYgKHRoaXMuYXBwTmFtZS5sZW5ndGggPT0gMCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBUEkgTmFtZSBjYW5ub3QgYmUgZW1wdHlcIik7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuc3RhZ2VOYW1lLmxlbmd0aCA9PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN0YWdlIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFdhcm1VcFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcHBOYW1lXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYXBwTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQXBwbGljYXRpb24gTmFtZVwiLFxyXG4gICAgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN0YWdlTmFtZVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnN0YWdlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RhZ2UgTmFtZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gTGFtYmRhIFJvbGVcclxuICAgIHRoaXMubGFtYmRhUm9sZUNyZWF0ZShwcm9wcyk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gSUFNIFVzZXIgYW5kIGdyb3Vwc1xyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgdGhpcy5pYW1Vc2VyQ3JlYXRlKHByb3BzKTtcclxuICAgIGNvbnN0IGFwcEdyb3VwID0gbmV3IGlhbS5Hcm91cCh0aGlzLCAnYXBwLWdyb3VwLWlkJywge1xyXG4gICAgICBncm91cE5hbWU6IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1fYXBwZ3JvdXBgXHJcbiAgICB9KTtcclxuICAgIGFwcEdyb3VwLmFkZFVzZXIodGhpcy5pYW1Vc2VyKTsgXHJcbiAgICBcclxuICAgIC8vIE5vdGU6IE1heGltdW0gcG9saWN5IHNpemUgb2YgMjA0OCBieXRlcyBleGNlZWRlZCBmb3IgdXNlclxyXG4gICAgY29uc3QgZmVzdEdyb3VwID0gbmV3IGlhbS5Hcm91cCh0aGlzLCAnZmVzdGl2YWwtZ3JvdXAtaWQnLCB7XHJcbiAgICAgIGdyb3VwTmFtZTogYCR7dGhpcy5hcHBOYW1lfV8ke3RoaXMuc3RhZ2VOYW1lfV9mZXN0Z3JvdXBgXHJcbiAgICB9KTtcclxuICAgIGZlc3RHcm91cC5hZGRVc2VyKHRoaXMuaWFtVXNlcik7XHJcblxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBWUENcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgdGhpcy5jcmVhdGVWUEMocHJvcHMpOyBcclxuICAgIFxyXG4gICAgY29uc3QgRHluYW1vR2F0ZXdheUVuZHBvaW50ID0gdGhpcy52cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdEeW5hbW8tZW5kcG9pbnQnLCB7XHJcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gU2VjdXJpdHkgZ3JvdXBcclxuICAgIHRoaXMuc2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCBgcmRzLXNnYCwge1xyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFJEUyAtIE15U1FMIDguMFxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIHRoaXMuc2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oIHRoaXMuc2VjdXJpdHlHcm91cCwgZWMyLlBvcnQudGNwKDMzMDYpKTtcclxuICAgIGlmICh0aGlzLmlzRGV2RW52KSB7XHJcbiAgICAgIC8vQWNjZXNzIGZyb20gTXlJUFxyXG4gICAgICB0aGlzLnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKCBlYzIuUGVlci5pcHY0KCcxMDAuMTAwLjEwMC4xMDAvMzInKSwgZWMyLlBvcnQudGNwUmFuZ2UoMSwgNjU1MzUpKTsgXHJcbiAgICB9XHJcbiAgICB0aGlzLmNyZWF0ZURCKHByb3BzKTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkRCRW5kUG9pbnRcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5kYlNlcnZlci5kYkluc3RhbmNlRW5kcG9pbnRBZGRyZXNzLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJSRFMgTXlTUUwgRW5kcG9pbnRcIixcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnREJTZWNyZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5kYlNlcnZlci5zZWNyZXQ/LnNlY3JldE5hbWUhLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJSRFMgTXlTUUwgU2VjcmV0IE5hbWVcIixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRHluYW1vXHJcbiAgICB0aGlzLmNyZWF0ZUR5bmFtbyhwcm9wcyk7XHJcbiAgICB0aGlzLkRDYWNoZS5ncmFudFJlYWRXcml0ZURhdGEoIGZlc3RHcm91cCk7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKCBmZXN0R3JvdXApO1xyXG5cclxuICAgIC8vIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEeW5hbW9EQ2FjaGVUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRDYWNoZS50YWJsZU5hbWUgfSk7XHJcbiAgICAvLyBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vRFRpY2tldFRhYmxlTmFtZScsIHsgdmFsdWU6IHRoaXMuRFRpY2tldC50YWJsZU5hbWUgfSk7XHJcbiAgICBcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFNRUyBUaWNrZXQgUXVldWVcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGNvbnN0IHRpY2tldFF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBgdGlja2V0cXVldWVgLCB7XHJcbiAgICAgIHF1ZXVlTmFtZTogYCR7dGhpcy5hcHBOYW1lfV8ke3RoaXMuc3RhZ2VOYW1lfV90aWNrZXRxdWV1ZWBcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTUVNUaWNrZXRVcmxcIiwge1xyXG4gICAgICB2YWx1ZTogdGlja2V0UXVldWUucXVldWVVcmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlNRUyBUaWNrZXQgVXJsXCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICB0aGlzLmVudlZhcnNbYFJFR0lPTmBdID0gY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRkVTVElWQUxUSUNLRVRTX1FVRVVFVVJMYF0gPSB0aWNrZXRRdWV1ZS5xdWV1ZVVybDtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfREVGQVVMVF9EQl9VUkxgXSA9IGBqZGJjOm15c3FsOi8vJHt0aGlzLmRiU2VydmVyLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3N9L2Zlc3RpdmFsdGlja2V0cz91c2VTU0w9ZmFsc2VgO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfSURgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCd1c2VybmFtZScpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9ERUZBVUxUX1VTRVJfUEFTU1dPUkRgXSA9IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXRWYWx1ZUZyb21Kc29uKCdwYXNzd29yZCcpO1xyXG4gICAgdGhpcy5lbnZWYXJzW2BHWF9EWU5BTU9EQkRTX1VTRVJfSURgXSA9IHRoaXMuYWNjZXNzS2V5LnJlZjtcclxuICAgIHRoaXMuZW52VmFyc1tgR1hfRFlOQU1PREJEU19VU0VSX1BBU1NXT1JEYF0gPSB0aGlzLmFjY2Vzc0tleS5hdHRyU2VjcmV0QWNjZXNzS2V5O1xyXG4gICAgXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBCYWNrb2ZmaWNlXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICB0aGlzLmNyZWF0ZUJhY2tvb2ZpY2UoKTtcclxuICAgIFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JhY2tvZmZpY2UgLSBBcHBydW5uZXItdXJsJywge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLmFwcFJ1bm5lci5zZXJ2aWNlVXJsfS9jb20uZmVzdGl2YWx0aWNrZXRzLmJ1c2luZXNzbG9naWMuYm9ob21lYCxcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBGZXN0aXZhbFRpY2tldHMgTGFtYmRhcyAoU1FTICYgQ1JPTilcclxuICAgIHRoaXMuY3JlYXRlRmVzdGl2YWxUaWNrZXRzTGFtYmRhcyggcHJvcHMpO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhVGlja2V0UHJvY2Vzc1wiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnF1ZXVlTGFtYmRhRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJUaWNrZXQgUHJvY2VzcyBMYW1iZGEgTmFtZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJMYW1iZGFDcm9uXCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuY3JvbkxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiVGlja2V0IFJ1ZmZsZSBMYW1iZGEgQ3JvblwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFNvbWUgcXVldWUgcGVybWlzc2lvbnNcclxuICAgIHRpY2tldFF1ZXVlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKHRoaXMucXVldWVMYW1iZGFGdW5jdGlvbik7XHJcbiAgICB0aWNrZXRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhmZXN0R3JvdXApO1xyXG4gICAgXHJcbiAgICAvLyBMYW1iZGEgcXVldWUgdHJpZ2dlclxyXG4gICAgY29uc3QgZXZlbnRTb3VyY2UgPSBuZXcgbGFtYmRhRXZlbnRTb3VyY2VzLlNxc0V2ZW50U291cmNlKHRpY2tldFF1ZXVlKTtcclxuICAgIHRoaXMucXVldWVMYW1iZGFGdW5jdGlvbi5hZGRFdmVudFNvdXJjZShldmVudFNvdXJjZSk7XHJcbiAgICBcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBTdG9yYWdlXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgY29uc3Qgc3RvcmFnZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1idWNrZXRgLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BQ0xTLFxyXG4gICAgICBhY2Nlc3NDb250cm9sOiBzMy5CdWNrZXRBY2Nlc3NDb250cm9sLkJVQ0tFVF9PV05FUl9GVUxMX0NPTlRST0xcclxuICAgIH0pO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFB1dEFjbChhcHBHcm91cCk7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwcEdyb3VwKTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRQdWJsaWNBY2Nlc3MoKTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN0b3JhZ2UtQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RvcmFnZSAtIEJ1Y2tldCBmb3IgU3RvcmFnZSBTZXJ2aWNlXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQmFja2VuZCBzZXJ2aWNlc1xyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgYCR7dGhpcy5hcHBOYW1lfS1hcGlnd2AsIHtcclxuICAgICAgZGVzY3JpcHRpb246IGAke3RoaXMuYXBwTmFtZX0gQVBJR2F0ZXdheSBFbmRwb2ludGAsXHJcbiAgICAgIHJlc3RBcGlOYW1lOiB0aGlzLmFwcE5hbWUsXHJcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcclxuICAgICAgICBzdGFnZU5hbWU6IHRoaXMuc3RhZ2VOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIlgtQW16LURhdGVcIixcclxuICAgICAgICAgIFwiQXV0aG9yaXphdGlvblwiLFxyXG4gICAgICAgICAgXCJYLUFwaS1LZXlcIixcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogW1wiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiXSxcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxyXG4gICAgICAgIGFsbG93T3JpZ2luczogW1wiKlwiXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uTmFtZSA9IGAke3RoaXMuYXBwTmFtZX1fJHt0aGlzLnN0YWdlTmFtZX1gO1xyXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tZnVuY3Rpb25gLCB7XHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogbGFtYmRhRnVuY3Rpb25OYW1lLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogbGFtYmRhSGFuZGxlck5hbWUsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogdGhpcy5sYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IHRoaXMuYXBwTmFtZVxyXG4gICAgICB9JyBTZXJ2ZXJsZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5zZWN1cml0eUdyb3VwXSxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRENhY2hlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZ1bmN0aW9uKTtcclxuICAgIGxhbWJkYUZ1bmN0aW9uLmdyYW50SW52b2tlKGFwcEdyb3VwKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gQW5ndWxhciBBcHAgSG9zdFxyXG4gICAgLy8gTWF4aW11bSBwb2xpY3kgc2l6ZSBvZiAyMDQ4IGJ5dGVzIGV4Y2VlZGVkIGZvciB1c2VyXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICBcclxuICAgIGNvbnN0IHdlYnNpdGVQdWJsaWNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGAke3RoaXMuYXBwTmFtZX0tYnVja2V0LXdlYmAsIHtcclxuICAgICAgd2Vic2l0ZUluZGV4RG9jdW1lbnQ6IFwiaW5kZXguaHRtbFwiLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUNMUyxcclxuICAgICAgYWNjZXNzQ29udHJvbDogczMuQnVja2V0QWNjZXNzQ29udHJvbC5CVUNLRVRfT1dORVJfRlVMTF9DT05UUk9MXHJcbiAgICB9KTtcclxuXHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcbiAgICB3ZWJzaXRlUHVibGljQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwcEdyb3VwKTtcclxuXHJcbiAgICBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlXCJdLFxyXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlID1cclxuICAgICAgbmV3IGNsb3VkZnJvbnQuZXhwZXJpbWVudGFsLkVkZ2VGdW5jdGlvbih0aGlzLCBgJHt0aGlzLmFwcE5hbWV9RWRnZUxhbWJkYWAsIHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6IGAke3RoaXMuYXBwTmFtZX0tJHt0aGlzLnN0YWdlTmFtZX0tRWRnZUxhbWJkYWAsXHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXHJcbiAgICAgICAgaGFuZGxlcjogcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSxcclxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoXCJsYW1iZGFcIiksXHJcbiAgICAgICAgZGVzY3JpcHRpb246IGBHZW5lWHVzIEFuZ3VsYXIgUmV3cml0ZSBMYW1iZGEgZm9yIENsb3VkZnJvbnRgLFxyXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyAgICAgICAgXHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5ncmFudEludm9rZShhcHBHcm91cCk7XHJcbiAgICByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UuYWRkQWxpYXMoXCJsaXZlXCIsIHt9KTtcclxuXHJcbiAgICBjb25zdCBvcmlnaW5Qb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5KFxyXG4gICAgICB0aGlzLFxyXG4gICAgICBgJHt0aGlzLmFwcE5hbWV9SHR0cE9yaWdpblBvbGljeWAsXHJcbiAgICAgIHtcclxuICAgICAgICAvL29yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBcIkdYLUhUVFAtT3JpZ2luLVBvbGljeVwiLFxyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gT3JpZ2luIEh0dHAgUG9saWN5YCxcclxuICAgICAgICBoZWFkZXJCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZUhlYWRlckJlaGF2aW9yLmFsbG93TGlzdChcclxuICAgICAgICAgIFwiQWNjZXB0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1DaGFyc2V0XCIsXHJcbiAgICAgICAgICBcIkFjY2VwdC1MYW5ndWFnZVwiLFxyXG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIixcclxuICAgICAgICAgIFwiR3hUWk9mZnNldFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VJZFwiLFxyXG4gICAgICAgICAgXCJEZXZpY2VUeXBlXCIsXHJcbiAgICAgICAgICBcIlJlZmVyZXJcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgICAgY29va2llQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVDb29raWVCZWhhdmlvci5hbGwoKSxcclxuICAgICAgfVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBwcm9wcz8uY2VydGlmaWNhdGVBUk5cclxuICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKFxyXG4gICAgICAgICAgdGhpcyxcclxuICAgICAgICAgIFwiQ2xvdWRmcm9udCBDZXJ0aWZpY2F0ZVwiLFxyXG4gICAgICAgICAgcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgICAgKVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCB3ZWJEaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke3RoaXMuYXBwTmFtZX0tY2RuYCxcclxuICAgICAge1xyXG4gICAgICAgIGNvbW1lbnQ6IGAke3RoaXMuYXBwTmFtZX0gQ2xvdWRmcm9udCBEaXN0cmlidXRpb25gLFxyXG4gICAgICAgIGRvbWFpbk5hbWVzOiBwcm9wcz8ud2ViRG9tYWluTmFtZSA/IFtwcm9wcz8ud2ViRG9tYWluTmFtZV0gOiB1bmRlZmluZWQsXHJcbiAgICAgICAgY2VydGlmaWNhdGU6IGNlcnRpZmljYXRlLFxyXG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xyXG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih3ZWJzaXRlUHVibGljQnVja2V0KSxcclxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxyXG4gICAgICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkNPUlNfUzNfT1JJR0lOLFxyXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XHJcbiAgICAgICAgICAgIGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXHJcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXHJcbiAgICAgICAgICBlZGdlTGFtYmRhczogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgZnVuY3Rpb25WZXJzaW9uOiByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UsXHJcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkxhbWJkYUVkZ2VFdmVudFR5cGUuT1JJR0lOX1JFU1BPTlNFLFxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgYXBpRG9tYWluTmFtZSA9IGAke2FwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7c3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcclxuXHJcbiAgICBjb25zdCBhcGlHYXRld2F5T3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlEb21haW5OYW1lLCB7XHJcbiAgICAgIHByb3RvY29sUG9saWN5OiBPcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgd2ViRGlzdHJpYnV0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShhcGkpO1xyXG5cclxuICAgIHdlYkRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcihgLyR7dGhpcy5zdGFnZU5hbWV9LypgLCBhcGlHYXRld2F5T3JpZ2luLCB7XHJcbiAgICAgIGNvbXByZXNzOiB0cnVlLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5BTExPV19BTEwsXHJcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogb3JpZ2luUG9saWN5LFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIC8vIEJhY2tlbmQgLSBBcGkgZ2F0ZXdheVxyXG4gICAgLy8gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcGlVUkxcIiwge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt3ZWJEaXN0cmlidXRpb24uZG9tYWluTmFtZX0vJHt0aGlzLnN0YWdlTmFtZX0vYCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQmFja2VuZCAtIFNlcnZpY2VzIEFQSSBVUkwgKFNlcnZpY2VzIFVSTClcIixcclxuICAgIH0pO1xyXG5cclxuXHJcbiAgICAvLyAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgICAvLyBGcm9udGVuZCAtIEFuZ3VsYXJcclxuICAgIC8vICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRnJvbnRlbmQtQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHdlYnNpdGVQdWJsaWNCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiRnJvbnRlbmQgLSBCdWNrZXQgTmFtZSBmb3IgQW5ndWxhciBXZWJTaXRlIERlcGxveW1lbnRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiRnJvbnRlbmQtV2ViVVJMXCIsIHtcclxuICAgICAgdmFsdWU6IGBodHRwczovLyR7d2ViRGlzdHJpYnV0aW9uLmRvbWFpbk5hbWV9YCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiRnJvbnRlbmQgLSBXZWJzaXRlIFVSTFwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhIC0gSUFNUm9sZUFSTlwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmxhbWJkYVJvbGUucm9sZUFybixcclxuICAgICAgZGVzY3JpcHRpb246IFwiSUFNIFJvbGUgQVJOXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFjY2Vzc0tleVwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFjY2Vzc0tleS5yZWYsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBLZXlcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NTZWNyZXRLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hY2Nlc3NLZXkuYXR0clNlY3JldEFjY2Vzc0tleSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQWNjZXNzIFNlY3JldCBLZXlcIixcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlhbVVzZXJDcmVhdGUocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyID0gbmV3IGlhbS5Vc2VyKHRoaXMsIGAke2FwaU5hbWV9LXVzZXJgKTtcclxuXHJcbiAgICAvLyBHZW5lcmljIFBvbGljaWVzXHJcbiAgICAvLyBTMyBneC1kZXBsb3kgd2lsbCBiZSB1c2VkIHRvIGRlcGxveSB0aGUgYXBwIHRvIGF3c1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiczM6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpneC1kZXBsb3kvKlwiLCBcImFybjphd3M6czM6OjpneC1kZXBsb3kqXCJdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIC8vIEdyYW50IGFjY2VzcyB0byBhbGwgYXBwbGljYXRpb24gbGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wibGFtYmRhOipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHthcGlOYW1lfV8qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmlhbVVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6YXBpZ2F0ZXdheToke3N0YWNrLnJlZ2lvbn06Oi9yZXN0YXBpcypgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiaWFtOlBhc3NSb2xlXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW3RoaXMubGFtYmRhUm9sZS5yb2xlQXJuXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBuZXcgaWFtLkNmbkFjY2Vzc0tleSh0aGlzLCBgJHthcGlOYW1lfS1hY2Nlc3NrZXlgLCB7XHJcbiAgICAgIHVzZXJOYW1lOiB0aGlzLmlhbVVzZXIudXNlck5hbWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgbGFtYmRhUm9sZUNyZWF0ZShwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgdGhpcy5sYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsIGBsYW1iZGEtcm9sZWAsIHtcclxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkNvbXBvc2l0ZVByaW5jaXBhbChcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJhcGlnYXRld2F5LmFtYXpvbmF3cy5jb21cIiksXHJcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwibGFtYmRhLmFtYXpvbmF3cy5jb21cIiksXHJcbiAgICAgICAgbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiYnVpbGQuYXBwcnVubmVyLmFtYXpvbmF3cy5jb21cIilcclxuICAgICAgKSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiR2VuZVh1cyBTZXJ2ZXJsZXNzIEFwcGxpY2F0aW9uIExhbWJkYSBSb2xlXCIsXHJcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFSb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhU1FTUXVldWVFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0FwcFJ1bm5lclNlcnZpY2VQb2xpY3lGb3JFQ1JBY2Nlc3NcIlxyXG4gICAgICAgIClcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlRHluYW1vKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICAvLyBUT0RPOiBWZXIgc2kgZW4gYWxnw7puIG1vbWVudG8gR3ggaW1wbGVtZW50YSBlbCBjYW1iaW8gZGUgbm9tYnJlIGVuIHRhYmxhcyBlbiBkYXRhdmlld3NcclxuICAgIC8vIFBhcnRpdGlvbmtleSBcImlkXCIgcG9yIGNvbXBhdGliaWxpZGFkIGNvbiBjb3Ntb3MgZGJcclxuICAgIHRoaXMuRENhY2hlID0gbmV3IGR5bmFtb2RiLlRhYmxlKCB0aGlzLCBgRENhY2hlYCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEQ2FjaGVgLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5EVGlja2V0ID0gbmV3IGR5bmFtb2RiLlRhYmxlKCB0aGlzLCBgRFRpY2tldGAsIHtcclxuICAgICAgdGFibGVOYW1lOiBgRFRpY2tldGAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLkRUaWNrZXQuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdUaWNrZXRDb2RlSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtuYW1lOiAnRFRpY2tldENvZGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklOR30sXHJcbiAgICAgIHJlYWRDYXBhY2l0eTogMSxcclxuICAgICAgd3JpdGVDYXBhY2l0eTogMSxcclxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuRFRpY2tldC5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtuYW1lOiAnREV2ZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUn0sXHJcbiAgICAgIHNvcnRLZXk6IHtuYW1lOiAnRFVzZXJFbWFpbCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HfSxcclxuICAgICAgcmVhZENhcGFjaXR5OiAxLFxyXG4gICAgICB3cml0ZUNhcGFjaXR5OiAxLFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgY3JlYXRlRmVzdGl2YWxUaWNrZXRzTGFtYmRhcyhwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy5xdWV1ZUxhbWJkYUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBgVGlja2V0UHJvY2Vzc2AsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fVGlja2V0UHJvY2Vzc2AsXHJcbiAgICAgIGVudmlyb25tZW50OiB0aGlzLmVudlZhcnMsXHJcbiAgICAgIHJ1bnRpbWU6IGRlZmF1bHRMYW1iZGFSdW50aW1lLFxyXG4gICAgICBoYW5kbGVyOiBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLmhhbmRsZXIuTGFtYmRhU1FTSGFuZGxlcjo6aGFuZGxlUmVxdWVzdFwiLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IHRoaXMubGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCBhcGlOYW1lXHJcbiAgICAgIH0nIFF1ZXVlIFRpY2tldCBQcm9jZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBDUk9OXHJcbiAgICB0aGlzLmNyb25MYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYENyb25MYW1iZGFgLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7YXBpTmFtZX1fJHtzdGFnZU5hbWV9X0Nyb25gLFxyXG4gICAgICBlbnZpcm9ubWVudDogdGhpcy5lbnZWYXJzLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5oYW5kbGVyLkxhbWJkYUV2ZW50QnJpZGdlSGFuZGxlcjo6aGFuZGxlUmVxdWVzdFwiLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IHRoaXMubGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCBhcGlOYW1lXHJcbiAgICAgIH0nIENyb24gUHJvY2VzcyBMYW1iZGEgZnVuY3Rpb25gLFxyXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt0aGlzLnNlY3VyaXR5R3JvdXBdXHJcbiAgICB9KTtcclxuICAgIC8vRXZlbnRCcmlkZ2UgcnVsZSB3aGljaCBydW5zIGV2ZXJ5IGZpdmUgbWludXRlc1xyXG4gICAgY29uc3QgY3JvblJ1bGUgPSBuZXcgUnVsZSh0aGlzLCAnQ3JvblJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBTY2hlZHVsZS5leHByZXNzaW9uKCdjcm9uKDAvMTAgKiAqICogPyAqKScpXHJcbiAgICB9KVxyXG4gICAgY3JvblJ1bGUuYWRkVGFyZ2V0KG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLmNyb25MYW1iZGFGdW5jdGlvbikpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEQihwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgY29uc3QgaW5zdGFuY2VJZGVudGlmaWVyID0gYCR7YXBpTmFtZX0tJHtzdGFnZU5hbWV9LWRiYDtcclxuXHJcbiAgICB0aGlzLmRiU2VydmVyID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsIGAke2FwaU5hbWV9LWRiYCwge1xyXG4gICAgICBwdWJsaWNseUFjY2Vzc2libGU6IHRoaXMuaXNEZXZFbnYsXHJcbiAgICAgIHZwY1N1Ym5ldHM6IHtcclxuICAgICAgICBvbmVQZXJBejogdHJ1ZSxcclxuICAgICAgICBzdWJuZXRUeXBlOiB0aGlzLmlzRGV2RW52ID8gZWMyLlN1Ym5ldFR5cGUuUFVCTElDIDogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU1xyXG4gICAgICB9LFxyXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21HZW5lcmF0ZWRTZWNyZXQoJ2RiYWRtaW4nKSxcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgcG9ydDogMzMwNixcclxuICAgICAgZGF0YWJhc2VOYW1lOiAnZmVzdGl2YWx0aWNrZXRzJyxcclxuICAgICAgYWxsb2NhdGVkU3RvcmFnZTogMjAsXHJcbiAgICAgIGluc3RhbmNlSWRlbnRpZmllcixcclxuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VJbnN0YW5jZUVuZ2luZS5teXNxbCh7XHJcbiAgICAgICAgdmVyc2lvbjogcmRzLk15c3FsRW5naW5lVmVyc2lvbi5WRVJfOF8wXHJcbiAgICAgIH0pLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF0sXHJcbiAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UNEcsIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8pLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmlzRGV2RW52ID8gY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSA6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTlxyXG4gICAgfSlcclxuICAgIGlmICh0aGlzLmlzRGV2RW52KXtcclxuICAgICAgY29uc29sZS5sb2coYCoqIEFaICoqICR7dGhpcy52cGMuYXZhaWxhYmlsaXR5Wm9uZXMubGVuZ3RofWApO1xyXG5cclxuICAgICAgZm9yKGxldCBpPTA7aTx0aGlzLnZwYy5hdmFpbGFiaWxpdHlab25lcy5sZW5ndGg7aSsrKXtcclxuICAgICAgICB0aGlzLmRiU2VydmVyLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLnZwYy5wdWJsaWNTdWJuZXRzW2ldLmludGVybmV0Q29ubmVjdGl2aXR5RXN0YWJsaXNoZWQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUJhY2tvb2ZpY2UoKXsgICAgXHJcbiAgICBjb25zdCB2cGNDb25uZWN0b3IgPSBuZXcgYXBwcnVubmVyLlZwY0Nvbm5lY3Rvcih0aGlzLCAnVnBjQ29ubmVjdG9yJywge1xyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICB2cGNTdWJuZXRzOiB0aGlzLnZwYy5zZWxlY3RTdWJuZXRzKHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9KSxcclxuICAgICAgdnBjQ29ubmVjdG9yTmFtZTogYCR7dGhpcy5hcHBOYW1lfV8ke3RoaXMuc3RhZ2VOYW1lfV9WcGNDb25uZWN0b3JgLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMuc2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuYXBwUnVubmVyID0gbmV3IGFwcHJ1bm5lci5TZXJ2aWNlKHRoaXMsICdCTy1BcHBydW5uZXInLCB7XHJcbiAgICAgIHNlcnZpY2VOYW1lOiBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2JvYCxcclxuICAgICAgc291cmNlOiBhcHBydW5uZXIuU291cmNlLmZyb21FY3Ioe1xyXG4gICAgICAgIGltYWdlQ29uZmlndXJhdGlvbjogeyBwb3J0OiA4MDgwIH0sXHJcbiAgICAgICAgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKHRoaXMsICdiYWNrb2ZmaWNlLXJlcG8nLCBgJHt0aGlzLmFwcE5hbWV9XyR7dGhpcy5zdGFnZU5hbWV9X2JvYCksXHJcbiAgICAgICAgdGFnT3JEaWdlc3Q6ICdsYXRlc3QnLFxyXG4gICAgICB9KSxcclxuICAgICAgdnBjQ29ubmVjdG9yLFxyXG4gICAgICBhY2Nlc3NSb2xlOiB0aGlzLmxhbWJkYVJvbGVcclxuICAgIH0pO1xyXG4gIH1cclxuICBwcml2YXRlIGNyZWF0ZVZQQyhwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMpe1xyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgdGhpcy52cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCBgdnBjYCwge1xyXG4gICAgICB2cGNOYW1lOiBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tdnBjYCxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGVfaXNvbGF0ZWQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU1xyXG4gICAgICAgIH1cclxuICAgICAgXSxcclxuICAgICAgbWF4QXpzOiAyXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG59XHJcbiJdfQ==