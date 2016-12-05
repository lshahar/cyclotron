#!/usr/bin/python
import os
import time 


def start_mongo():
    os.system('/etc/init.d/mongodb start')

def start_cyclotron_svc():
    os.system('cd cyclotron-svc; node app.js &')

def start_cyclotron_site():
    os.system('cd cyclotron-site; gulp server &')
    
start_mongo()
start_cyclotron_svc()
start_cyclotron_site()

while True:
    time.sleep(60)

