from laindex.config import LocationConfig
from laindex.parsing.location import qualifies_location
from laindex.parsing.money import estimate_all_in
from laindex.scoring.door_hardware import classify
from laindex.scoring.interests import weighted_score


def test_geography_city_and_boundary():
    cfg=LocationConfig()
    assert qualifies_location("Glendale","AZ",-112.18,cfg).qualifies
    assert not qualifies_location("Mesa","AZ",-111.8,cfg).qualifies
    assert not qualifies_location("Phoenix","AZ",-111.99,cfg).qualifies


def test_all_in_does_not_treat_bid_as_total():
    result=estimate_all_in(90,15,9.2,2,True)
    assert result.high > 100
    assert result.low <= result.high


def test_interest_and_door_classifier():
    assert weighted_score("Skutt pottery kiln controller")[0] >= 70
    good=classify("matte black exterior door lever with round rose keyed entry")
    bad=classify("brass cabinet pull with rectangular backplate")
    assert good[0] > bad[0]
