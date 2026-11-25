import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CFN_DIR = path.join(ROOT, 'infra', 'cloudformation');

function readCfn(filename: string): string {
  return fs.readFileSync(path.join(CFN_DIR, filename), 'utf8');
}

describe('Phase 4 — AWS CloudFormation IaC, EC2 Bootstrap & Release Security Guards', () => {
  it('enforces zero public SSH and private RDS isolation in 01-network.yaml', () => {
    const net = readCfn('01-network.yaml');
    expect(net).toContain("AWSTemplateFormatVersion: '2010-09-09'");
    expect(net).toContain('AWS::EC2::VPC');
    expect(net).toContain('PrivateDbSubnetA');
    expect(net).toContain('PrivateDbSubnetB');
    // Port 22 must NEVER be exposed in AppHostSecurityGroup
    expect(net).not.toMatch(/FromPort:\s*22\b/);
    expect(net).not.toMatch(/ToPort:\s*22\b/);
    // RDS security group only accepts TCP 3306 from AppHostSecurityGroup
    expect(net).toContain('SourceSecurityGroupId: !Ref AppHostSecurityGroup');
    expect(net).toContain('FromPort: 3306');
  });

  it('enforces private encrypted MySQL 8.4 db.t3.micro, private S3 AES256, and SQS DLQ in 02-data-and-messaging.yaml', () => {
    const data = readCfn('02-data-and-messaging.yaml');
    expect(data).toContain("EngineVersion: '8.4'");
    expect(data).toContain('DBInstanceClass: db.t3.micro');
    expect(data).toContain('PubliclyAccessible: false');
    expect(data).toContain('StorageEncrypted: true');
    expect(data).toContain('MultiAZ: false');
    expect(data).toContain("require_secure_transport: 'ON'");
    expect(data).toContain('BlockPublicAcls: true');
    expect(data).toContain('RestrictPublicBuckets: true');
    expect(data).toContain('SSEAlgorithm: AES256');
    expect(data).toContain('RedrivePolicy:');
    expect(data).toContain('AnalysisDeadLetterQueue');
  });

  it('enforces IMDSv2, encrypted t3.small Launch Template, and scoped GitHub OIDC role in 03-iam-oidc-and-compute.yaml', () => {
    const compute = readCfn('03-iam-oidc-and-compute.yaml');
    expect(compute).toContain('AWS::EC2::LaunchTemplate');
    expect(compute).toContain('InstanceType: t3.small');
    expect(compute).toContain('HttpTokens: required');
    expect(compute).toContain('Encrypted: true');
    expect(compute).toContain('sts:AssumeRoleWithWebIdentity');
    expect(compute).toContain('token.actions.githubusercontent.com:aud: sts.amazonaws.com');
    expect(compute).toContain('repo:${GithubOrg}/${BackendRepoName}:ref:refs/heads/main');
    expect(compute).not.toContain('AWS_ACCESS_KEY_ID');
  });

  it('enforces $40/month AWS Budgets cap with 50%, 80%, and 100% notifications in 04-budgets.yaml', () => {
    const budget = readCfn('04-budgets.yaml');
    expect(budget).toContain('AWS::Budgets::Budget');
    expect(budget).toContain('Default: 40');
    expect(budget).toContain('Threshold: 50');
    expect(budget).toContain('Threshold: 80');
    expect(budget).toContain('Threshold: 100');
    expect(budget).toContain('NotificationType: FORECASTED');
  });

  it('verifies every cross-stack Fn::ImportValue matches an Export in Stacks 01–02', () => {
    const net = readCfn('01-network.yaml');
    const data = readCfn('02-data-and-messaging.yaml');
    const compute = readCfn('03-iam-oidc-and-compute.yaml');

    const exports = new Set<string>();
    for (const src of [net, data, compute]) {
      for (const m of src.matchAll(/Export:\s*\n\s*Name:\s*!Sub\s+([^\s]+)/g)) {
        if (m[1]) exports.add(m[1]);
      }
    }

    for (const src of [data, compute]) {
      for (const m of src.matchAll(/Fn::ImportValue:\s*!Sub\s+([^\s]+)/g)) {
        expect(exports.has(m[1]!)).toBe(true);
      }
    }
  });

  it('verifies GitHub Actions workflows pin third-party actions to full 40-char SHAs and contain no static AWS keys', () => {
    const wfDir = path.join(ROOT, '.github', 'workflows');
    for (const file of ['ci.yml', 'release-and-deploy.yml']) {
      const content = fs.readFileSync(path.join(wfDir, file), 'utf8');
      expect(content).not.toContain('AWS_SECRET_ACCESS_KEY');
      const usesMatches = [
        ...content.matchAll(/uses:\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)@([^\s#]+)/g),
      ];
      expect(usesMatches.length).toBeGreaterThan(0);
      for (const match of usesMatches) {
        expect(match[2]).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
