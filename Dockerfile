# Pull base image.
FROM node:0.12.6

MAINTAINER Mamadou Bobo Diallo <bobo@edyn.com>

RUN apt-get update && apt-get install -y postgresql-client redis-tools

# Define working directory.
WORKDIR /www/app

# use changes to package.json to force Docker not to use the cache
# when we change our application's nodejs dependencies:
ADD package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /www/app/ && cp -a /tmp/node_modules /www/app/

ADD . /www/app/

# Define default command.
CMD ["node", "run.js"]

VOLUME /var/log/
