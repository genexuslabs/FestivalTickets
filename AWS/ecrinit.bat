@echo off
aws ecr create-repository --repository-name %1_%2_bo --image-scanning-configuration scanOnPush=false 

for /f %%i in ('aws sts get-caller-identity --query "Account" --output text') do set AWSACC=%%i

rem Dummy image push
docker build -t ftimage:latest ./docker

aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin %AWSACC%.dkr.ecr.us-east-1.amazonaws.com

docker tag ftimage:latest %AWSACC%.dkr.ecr.us-east-1.amazonaws.com/%1_%2_bo:latest
docker push %AWSACC%.dkr.ecr.us-east-1.amazonaws.com/%1_%2_bo:latest