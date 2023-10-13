# AWS Commands - Half vcpu per container, 8 containers per task

## Setup

For each region:

1. Modify `<region>-task-definition.json` to use your own container image URI (multiple places) and `executionRoleArn` (a role with permissions policy "AmazonECSTaskExecutionRolePolicy").

2. ECS -> Create cluster:

- name: collabs-nsdi-clients
- Infrastructure: AWS Fargate
- Rest default.

3. ECS -> Task definitions:

- Create new task definition with JSON
- Paste in contents of `<region>-task-definition.json` from this folder

> To modify the setup for a new region:
>
> 1. To reduce bandwidth costs, push a copy of the container to that region's ECR, then update its URI in the task definitions.
> 2. Start launching a task in that region using the AWS console (but don't actually launch).
> 3. Select all subnets, copy their names ("subnet-..."), then paste into the "subnets" array in that region's commands below. (Allowing all subnets lets our containers be scheduled in any AZ.)

## Per experiment

1. Set $URL.
2. Find correct command for region.
3. Change count if needed. Note that it is 1/16th the experiment size (8 clients per task x 2 regions).

You save money (~4x) by using `FARGATE_SPOT`, but you may get "capacity unavailable" messages. If that happens, check how many instances actually did start using the AWS console (or the terminal's `failures` output), then retry the needed extras or start them as `FARGATE` instances (see "On-demand versions" below).

### us-west-1 (N California)

```bash
aws ecs run-task --no-cli-pager --region us-west-1 \
--cluster collabs-nsdi-clients \
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0d97c34e5713def63", "subnet-0724fa536688bfc1c"], "assignPublicIp": "ENABLED"}}' \
--overrides "{\"containerOverrides\": [{\"name\": \"client0\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client1\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client2\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client3\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client4\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client5\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client6\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client7\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}]}" \
--task-definition collabs-nsdi-client-half-x8:1 \
--count 8
```

### eu-north-1 (Stockholm)

```bash
aws ecs run-task --no-cli-pager --region eu-north-1 \
--cluster collabs-nsdi-clients \
--capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1,base=0 \
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0ad3f0086a76e2048", "subnet-0d018ebca70386512", "subnet-02f85f5ba0e866b57"], "assignPublicIp": "ENABLED"}}' \
--overrides "{\"containerOverrides\": [{\"name\": \"client0\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client1\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client2\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client3\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client4\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client5\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client6\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client7\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}]}" \
--task-definition collabs-nsdi-client-half-x8:1 \
--count 8
```

### On-demand versions (more expensive)

```bash
aws ecs run-task --no-cli-pager --region us-west-1 \
--cluster collabs-nsdi-clients \
--capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=0 \
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0d97c34e5713def63", "subnet-0724fa536688bfc1c"], "assignPublicIp": "ENABLED"}}' \
--overrides "{\"containerOverrides\": [{\"name\": \"client0\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client1\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client2\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client3\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client4\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client5\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client6\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client7\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}]}" \
--task-definition collabs-nsdi-client-half-x8:1 \
--count 2
```

On-demand

```bash
aws ecs run-task --no-cli-pager --region eu-north-1 \
--cluster collabs-nsdi-clients \
--capacity-provider-strategy capacityProvider=FARGATE,weight=1,base=0 \
--network-configuration '{"awsvpcConfiguration": {"subnets": ["subnet-0ad3f0086a76e2048", "subnet-0d018ebca70386512", "subnet-02f85f5ba0e866b57"], "assignPublicIp": "ENABLED"}}' \
--overrides "{\"containerOverrides\": [{\"name\": \"client0\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client1\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client2\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client3\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client4\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client5\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client6\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}, {\"name\": \"client7\", \"environment\": [{\"name\": \"URL\", \"value\": \"$URL\"}]}]}" \
--task-definition collabs-nsdi-client-half-x8:1 \
--count 2
```

On-demand
