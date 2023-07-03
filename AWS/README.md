# FestivalTickets - AWS CDK Sample
Festival Tickets is an example of a massive event ticket giveaway, which can have hundreds of thousands or millions of subscriptions per hour.

For more information about FestivalTickets, follow this link:
[FestivalTickets Sample](https://wiki.genexus.com/commwiki/servlet/wiki?51266,KB%3AFestivalTickets+-+High+Scalability+Sample)

This stack will Deploy:
* Amazon VPC
* IAM User
* IAM Rol
* Amazon DynamoDB Table DTicket
* Amazon DynamoDB Table DCache
* Amazon RDS MySQL 8.0
* SecurityGroup for RDS (with a rule for your public IP to access the db)
* Amazon SQS Queue for ticket process
* AWS Lambda to process the Queue
* AWS Lambda Cron for ticket ruffle
* Amazon EventBridge rule for lambda con
* Amazon S3 Bucket for Angular App (frontend)
* Amazon S3 Bucket for Storage
* Amazon API Gateway (backend)
* AWS Lambda (backend)
* AWS Lambda (rewrite)
* Amazon Cloudfront - GeneXus Angular Rewrite Lambda

## Disclaimer
By running this code you may incur in cloud infrastructure costs.

## Requirements
* [Node.js](https://nodejs.org/en)
* Amazon AWS CDK
    * Install after Node.js by running: npm i aws-cdk -g
* [Docker](https://www.docker.com/)

## Running the script
Run in your cmd: 
```
//Navigate to a folder of your preference
git clone https://github.com/genexuslabs/FestivalTickets.git
cd FestivalTickets/AWS
npm install
npm run build
cdk bootstrap
cdk deploy -c appname=festivalticketsapp -c stage=test
```

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
