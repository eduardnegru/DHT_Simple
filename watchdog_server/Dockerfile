FROM ubuntu:18.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    memcached \
    systemd
WORKDIR /usr/src/app
COPY . .
CMD [ "./start.sh" ]
