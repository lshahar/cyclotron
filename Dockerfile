FROM debian:jessie
MAINTAINER Shahar l shahar@shaharl.co.il
EXPOSE 8080
EXPOSE 8077
RUN \
    apt-get update &&\
    apt-get install -y curl sudo make mongodb wget nano git bzip2

RUN \
    curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash - ;   apt-get install -y nodejs 

RUN npm install phantomjs-prebuilt
RUN npm install -g gulp

COPY cyclotron-site /cyclotron-site
COPY cyclotron-svc /cyclotron-svc
RUN cd /cyclotron-svc/ ; npm install
RUN cp /cyclotron-svc/config/docker.config.js /cyclotron-svc/config/config.js
RUN npm install -g npm
#RUN cd /cyclotron-site/app/scripts/config/; ls ; cp docker.ConfigService.coffee ConfigService.coffee #docker.configService.coffee /cyclotron-site/app/scripts/config/configService.coffee
RUN cd /cyclotron-site/; npm install gulp ; npm install ; gulp build  


ENV URL='http://cyc.senexx.com:8888'
ENV APIURL='http://10.0.10.4:8077'
COPY runner.py /runner.py

ENTRYPOINT ["/runner.py"]