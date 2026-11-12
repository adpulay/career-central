// CDK app entry. Configuration comes from CDK context (see docs/AWS_C1.md).
// `cdk synth` needs no AWS credentials; `cdk deploy` is a separate approved step.
import {App, Validations} from 'aws-cdk-lib';
import cdkNag from 'cdk-nag';
const {AwsSolutionsChecks} = cdkNag; // CommonJS package
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {contextConfig} from '../lib/config.mjs';
import {MonitorStack} from '../lib/monitor-stack.mjs';

// No AWS::CDK::Metadata resource: library-version reporting is not needed.
const app = new App({analyticsReporting: false});
const config = contextConfig(app.node.tryGetContext('careerCentral'));
const bundleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/monitor-tick');
new MonitorStack(app, `CareerCentralMonitor-${config.environment}`, {config, bundleDir,
  ...(config.account ? {env: {account: config.account, region: config.region}} : {})});
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
