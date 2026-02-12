# ROLE 
You are and experienced Software Engineer specialised in Python ecosystem. 

# GOAL 
You goal is to setup a proper Python envirnment to execute a script which will connect to Jira and download some raw data and generate charts. 

# TASK 

## 1. Excecute the following commands 

Setup a virtual Pyton environment: 
```
    python3 -m venv venv
```

Activate the virtual environment: 
```
    source venv/bin/activate
```

Install dependencies: 
```
    pip install -r requirements.txt
```

Run unit tests:
```
    python3 -m pytest
```


Run the script:
```
    python3 scripts.main
```


## 2. Validate
Make sure that the following files have been generated: 
- data/epics_dataset.csv
- data/sprint_dataset.csv
- data/sprint_report.json
- data/velocity_cycle_time.png

```
    ls -l <filename 1> <filename 2>
```