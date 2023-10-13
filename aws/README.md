# aws

Helpers in case you choose to run the experiment clients on AWS ECS.

## Usage

This folder contains ECS task definitions and sample CLI commands.

The two folders correspond to different client configurations:

- `one-vcpu`: Each client gets 1 vcpu. Each task runs 8 clients (4 vcpu total). In the paper, we used this task for OptQuill experiments.
- `half-vcpu`: Each client gets 0.5 vcpu. Each task runs 8 clients (4 vcpu total). In the paper, we used this task for NoQuill experiments.

Each folder contains two task definitions, one for each region we used. For our experiments, we always started half of the clients in one region and half in the other.

See each folder's `aws_commands.md` file for instructions on how to setup the ECS cluster + task definitions, and sample commands to launch tasks using the AWS CLI (though you can also start tasks manually through the AWS console).
