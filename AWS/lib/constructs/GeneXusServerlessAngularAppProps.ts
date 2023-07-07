import * as cdk from "aws-cdk-lib";

export interface GeneXusServerlessAngularAppProps extends cdk.StackProps {
    readonly apiName: string;
    readonly apiDescription?: string;
    readonly webDomainName?: string;
    readonly stageName?: string;
    readonly timeout?: cdk.Duration;
    readonly memorySize?: number;
    readonly certificateARN?: string | null;
}