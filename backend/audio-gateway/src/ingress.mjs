// CloudFront VPC ingress is valid only behind a private ALB restricted to the
// AWS-managed CloudFront origin prefix list. The distribution requires HTTPS
// and overwrites this header; the origin hop never traverses the public internet.
export function secureIngress(headers, mode = 'alb-tls') {
  // This mode is reachable only through the account's CloudFront VPC-origin
  // service security group. CloudFront overwrites the viewer header.
  if (mode === 'cloudfront-ec2') return headers['x-qlue-viewer-proto'] === 'https';
  if (mode === 'cloudfront-vpc') {
    return headers['x-forwarded-proto'] === 'http' &&
      headers['x-qlue-viewer-proto'] === 'https';
  }
  return mode === 'alb-tls' && headers['x-forwarded-proto'] === 'https';
}
