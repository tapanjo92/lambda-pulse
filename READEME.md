Absolutely! Here's a comprehensive, step-by-step deployment guide for your **LambdaPulse project** on an **Ubuntu 20.04** server. This includes all details, prerequisites, and commands clearly organized.

---

# 🚀 LambdaPulse Deployment Guide (Ubuntu 20.04)

---

## ✅ **Step 1: Server Preparation**

### 1.1 Update & Upgrade Ubuntu

```bash
sudo apt update -y && sudo apt upgrade -y
```

### 1.2 Install Essential Packages

```bash
sudo apt install -y build-essential curl wget git software-properties-common
```

---

## ✅ **Step 2: Install Node.js & npm**

Use Node Version Manager (nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
source ~/.bashrc

nvm install 18
nvm use 18
node -v && npm -v
```

You should see:

```
v18.x.x
8.x.x
```

---

## ✅ **Step 3: Install & Configure Git**

```bash
sudo apt install git -y
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

**Setup SSH keys for GitHub** (if repo private):

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
```

* Copy the printed SSH key and add it to your GitHub under **Settings → SSH Keys**.

---

## ✅ **Step 4: Install AWS CLI v2**

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip
sudo ./aws/install
aws --version
```

**Configure AWS CLI**:

```bash
aws configure --profile lambdapulse-dev
```

Enter your IAM user’s credentials:

* **AWS Access Key ID**: Your key
* **AWS Secret Access Key**: Your secret
* **Default region**: e.g., `ap-south-1`
* **Default output**: `json`

Verify configuration:

```bash
aws sts get-caller-identity --profile lambdapulse-dev
```

---

## ✅ **Step 5: Install AWS CDK v2**

```bash
npm install -g aws-cdk
cdk --version
```

Bootstrap CDK (one-time per account):

```bash
export AWS_PROFILE=lambdapulse-dev
cdk bootstrap aws://YOUR_ACCOUNT_ID/ap-south-1
```

Replace `YOUR_ACCOUNT_ID` with your AWS Account ID.

---

## ✅ **Step 6: Clone & Setup LambdaPulse Repo**

### 6.1 Clone Your Repository:

```bash
git clone git@github.com:your-org/lambdapulse.git
cd lambdapulse
```

### 6.2 Monorepo Setup (root level):

Edit/create a root `package.json`:

```json
{
  "private": true,
  "workspaces": ["infra", "backend", "frontend"],
  "scripts": {
    "build": "npm run build --workspaces"
  }
}
```

Install dependencies for all packages:

```bash
npm install
```

---

## ✅ **Step 7: Deploy Infrastructure (CDK)**

```bash
cd ~/lambdapulse/infra
npm install
npm run build
```

### Check stack availability:

```bash
cdk ls
```

You should see your stack (`LambdaPulseStack`).

### Deploy to AWS:

```bash
export AWS_PROFILE=lambdapulse-dev
cdk deploy
```

Confirm the IAM changes when prompted (`y`).

---

## ✅ **Step 8: Deploy Backend Lambdas**

```bash
cd ~/lambdapulse/backend
npm install
npm run build
```

Verify build outputs (`dist/`):

```bash
ls dist
```

(You should see compiled JavaScript files.)

Redeploy Infrastructure (now with backend lambdas):

```bash
cd ~/lambdapulse/infra
npm run build
cdk deploy
```

---

## ✅ **Step 9: Deploy Next.js Frontend**

```bash
cd ~/lambdapulse/frontend
npm install
npm run build
```

Run locally (for verification):

```bash
npm run dev
```

Visit your browser:

```
http://server-ip:3000
```

---

## ✅ **Step 10: Optional - Configure Nginx Reverse Proxy for Frontend**

Install Nginx:

```bash
sudo apt install nginx -y
```

Configure reverse proxy:

```bash
sudo vi /etc/nginx/sites-available/lambdapulse
```

Paste this Nginx config:

```nginx
server {
  listen 80;
  server_name your-domain.com server-ip;

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

Enable and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/lambdapulse /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Now your Next.js dashboard is accessible via port 80.

---

## ✅ **Step 11: Verify Entire Setup**

* **CDK Stack**:
  AWS Console → CloudFormation → Check stacks

* **Lambdas**:
  AWS Console → Lambda → Check functions created (`ProcessorFunction`, `EtlFunction`)

* **API Gateway**:
  AWS Console → API Gateway → Verify deployed API, test endpoint via curl

* **Kinesis Firehose**:
  AWS Console → Firehose → Verify delivery stream configured correctly

---

## ✅ **Step 12: Monitoring & Debugging (CloudWatch)**

* Logs: AWS CloudWatch → Logs
* Metrics: AWS CloudWatch → Metrics (Lambda metrics, API Gateway metrics)

---

## ✅ **Step 13: Commit & Push**

```bash
cd ~/lambdapulse
git add .
git commit -m "feat(deployment): initial deployment complete"
git push
```

---

## 🎉 **Deployment Complete!**

**Your LambdaPulse SaaS stack (Infra, Backend, Frontend)** is now deployed and fully operational.

### Next recommended steps:

* **Implement ETL Logic**: parsing, enrichment, DynamoDB metrics ingestion.
* **Enhance Next.js Frontend**: visualizations, user auth via Cognito.
* **Configure Alerting & Compliance**: SNS alerts, multi-tenant setup, compliance standards.

Let me know if any step needs additional clarity or if you face any issue at all!

