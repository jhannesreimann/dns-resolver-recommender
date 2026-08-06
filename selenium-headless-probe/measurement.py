import os
import sys
import time
from pathlib import Path

from selenium.webdriver.firefox.service import Service
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


URL = os.getenv("MEASUREMENT_URL", "https://dns.diic-hpi.org")
TIMEOUT = int(os.getenv("MEASUREMENT_TIMEOUT", "900"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/app/output"))

OPT_IN_TEXT_MATCHES = (
    "share anonymized results",
    "share anonymous data",
    "anonymous data",
)


def first_clickable(driver, selectors, timeout=30):
    """Return the first visible and clickable element matching the selectors."""
    end_time = time.monotonic() + timeout

    while time.monotonic() < end_time:
        for by, selector in selectors:
            elements = driver.find_elements(by, selector)

            for element in elements:
                try:
                    if element.is_displayed() and element.is_enabled():
                        return element
                except Exception:
                    continue

        time.sleep(0.25)

    raise TimeoutException(
        f"No clickable element found using selectors: {selectors}"
    )


def click_opt_in(driver):
    wait = WebDriverWait(driver, 30)

    # Wait until the application has rendered its controls.
    wait.until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    opt_in = wait.until(find_opt_in_control)
    driver.execute_script(
        "arguments[0].scrollIntoView({block: 'center'});",
        opt_in,
    )

    checked = (
        opt_in.is_selected()
        if opt_in.tag_name.lower() == "input"
        else opt_in.get_attribute("aria-checked") == "true"
    )

    if not checked:
        try:
            opt_in.click()
        except Exception:
            driver.execute_script("arguments[0].click();", opt_in)

    if opt_in.tag_name.lower() == "input" and not opt_in.is_selected():
        raise TimeoutException("The anonymous-data opt-in did not stay enabled.")

    print("Anonymous research-data sharing enabled.", flush=True)


def find_opt_in_control(driver):
    control_selectors = [
        "input[type='checkbox']",
        "[role='checkbox']",
        "[role='switch']",
    ]

    for selector in control_selectors:
        for element in driver.find_elements(By.CSS_SELECTOR, selector):
            try:
                text = opt_in_context_text(driver, element)
                if element.is_displayed() and matches_opt_in_text(text):
                    return element
            except Exception:
                continue

    return False


def opt_in_context_text(driver, element):
    labelled_by = element.get_attribute("aria-labelledby")
    if labelled_by:
        labels = []
        for label_id in labelled_by.split():
            label = driver.find_elements(By.ID, label_id)
            if label:
                labels.append(label[0].text)
        if labels:
            return " ".join(labels)

    aria_label = element.get_attribute("aria-label")
    if aria_label:
        return aria_label

    element_id = element.get_attribute("id")
    if element_id:
        labels = driver.find_elements(
            By.XPATH,
            f"//label[@for={xpath_literal(element_id)}]",
        )
        if labels:
            return " ".join(label.text for label in labels)

    label_ancestor = element.find_elements(By.XPATH, "./ancestor::label[1]")
    if label_ancestor:
        return label_ancestor[0].text

    return element.text


def xpath_literal(value):
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'

    return "concat(" + ', "\"", '.join(
        f"'{part}'" for part in value.split('"')
    ) + ")"


def matches_opt_in_text(text):
    normalized = " ".join(text.lower().split())
    return any(match in normalized for match in OPT_IN_TEXT_MATCHES)


def click_start_measurement(driver):
    wait = WebDriverWait(driver, 30)

    selectors = [
        (
            By.XPATH,
            "//button[contains("
            "translate(normalize-space(.), "
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
            "'abcdefghijklmnopqrstuvwxyz'), "
            "'start measurement'"
            ")]",
        ),
        (
            By.XPATH,
            "//*[@role='button' and contains("
            "translate(normalize-space(.), "
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
            "'abcdefghijklmnopqrstuvwxyz'), "
            "'start measurement'"
            ")]",
        ),
        (
            By.XPATH,
            "//input["
            "(@type='button' or @type='submit') and "
            "contains("
            "translate(@value, "
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
            "'abcdefghijklmnopqrstuvwxyz'), "
            "'start measurement'"
            ")"
            "]",
        ),
    ]

    for by, selector in selectors:
        elements = driver.find_elements(by, selector)

        for element in elements:
            try:
                if element.is_displayed() and element.is_enabled():
                    driver.execute_script(
                        "arguments[0].scrollIntoView({block: 'center'});",
                        element,
                    )

                    try:
                        element.click()
                    except Exception:
                        driver.execute_script(
                            "arguments[0].click();",
                            element,
                        )

                    print("Measurement started.", flush=True)
                    return

            except Exception:
                continue

    raise TimeoutException(
        "Could not find the 'Start measurement' button."
    )


def measurement_finished(driver):
    body_text = driver.find_element(By.TAG_NAME, "body").text.lower()

    completion_phrases = (
        "measurement completed",
        "measurement complete",
        "measurement finished",
        "measurement is done",
        "measurement done",
        "results are available",
        "measurement results",
    )

    if any(phrase in body_text for phrase in completion_phrases):
        return True

    # Some applications show their results without explicit completion text.
    result_selectors = [
        "[data-testid*='result']",
        "[class*='result']",
        "[id*='result']",
        "[data-testid*='complete']",
        "[class*='complete']",
        "[id*='complete']",
    ]

    for selector in result_selectors:
        for element in driver.find_elements(By.CSS_SELECTOR, selector):
            try:
                if element.is_displayed() and element.text.strip():
                    return True
            except Exception:
                continue

    return False


def save_screenshot(driver, filename):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / filename
    driver.save_screenshot(str(path))
    print(f"Screenshot saved to {path}", flush=True)


def main():
    options = Options()
    options.add_argument("-headless")
    options.set_preference("browser.cache.disk.enable", False)
    options.set_preference("browser.cache.memory.enable", False)

    options.binary_location = "/usr/bin/firefox-esr"
    service = Service(
        executable_path="/usr/local/bin/geckodriver",
        log_output=sys.stdout,
    )

    driver = webdriver.Firefox(
        service=service,
        options=options,
    )

    try:
        driver.set_page_load_timeout(60)
        driver.set_window_size(1440, 1200)

        print(f"Opening {URL}", flush=True)
        driver.get(URL)

        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )

        click_opt_in(driver)
        click_start_measurement(driver)

        print(
            f"Waiting up to {TIMEOUT} seconds for completion...",
            flush=True,
        )

        WebDriverWait(
            driver,
            TIMEOUT,
            poll_frequency=1,
        ).until(measurement_finished)

        print("Measurement completed successfully.", flush=True)
        save_screenshot(driver, "measurement-result.png")

    except Exception as error:
        print(
            f"Measurement failed: {type(error).__name__}: {error}",
            file=sys.stderr,
            flush=True,
        )

        try:
            save_screenshot(driver, "measurement-error.png")
        except Exception:
            pass

        raise

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
